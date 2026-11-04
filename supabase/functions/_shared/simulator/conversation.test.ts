// supabase/functions/_shared/simulator/conversation.test.ts
// The simulated call's turn loop (M5 test list, fake LLMs): max 10 turns, tools in Asha's context
// only, every end reason, tool chains capped, a tool sent with the goodbye still runs.
import { assertEquals, assertStringIncludes } from '@std/assert';
import type { ChatMessage } from '../llm/json-llm.ts';
import type { ToolResult } from '../tools/types.ts';
import { type ChatFn, converse, MAX_TOOL_STEPS, MAX_TURNS } from './conversation.ts';

const GREETING = 'Namaste, am I speaking with Ramesh garu of Ramesh Kirana?';

/** Answers from a script, in order; null once it runs out (a failed model). */
function scripted(answers: readonly (string | null)[], seen: ChatMessage[][] = []): ChatFn {
  let next = 0;
  return (messages) => {
    seen.push([...messages]);
    const answer = answers[next] ?? null;
    next += 1;
    return Promise.resolve(answer);
  };
}

function asha(say: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ say, tool: null, end_call: false, ...extra });
}

function shop(say: string, hangUp = false): string {
  return JSON.stringify({ say, hang_up: hangUp });
}

function tools(calls: string[]): (name: string, args: unknown) => Promise<ToolResult> {
  return (name) => {
    calls.push(name);
    return Promise.resolve({ ok: true, say: `${name} done`, data: { outstanding: 8500 } });
  };
}

Deno.test('conversation › greeting first; tools stay out of the transcript; Asha ends the call', async () => {
  const calls: string[] = [];
  const ashaSeen: ChatMessage[][] = [];
  const result = await converse(GREETING, {
    asha: scripted([
      asha('', { tool: { name: 'confirm_identity', args: { answer: 'confirmed' } } }),
      asha('Thank you. You owe 8,500 rupees.'),
      asha('Thank you, goodbye.', { end_call: true }),
    ], ashaSeen),
    shopkeeper: scripted([shop('Yes, speaking.'), shop('I will pay Monday.')]),
    runTool: tools(calls),
  });
  assertEquals(result.end, 'asha_ended');
  assertEquals(result.transcript.map((t) => t.role), [
    'assistant',
    'user',
    'assistant',
    'user',
    'assistant',
  ]);
  assertEquals(result.transcript[0]?.content, GREETING);
  assertEquals([calls, result.toolCalls], [['confirm_identity'], 1]);
  const afterTool = ashaSeen[1] ?? [];
  assertStringIncludes(
    afterTool.at(-1)?.content ?? '',
    'TOOL REPLY confirm_identity: {"outstanding":8500',
  );
  assertEquals(afterTool[0]?.role, 'user');
  // Native tool format: Asha's call, then the reply tied to it by id.
  const call = afterTool.at(-2);
  assertEquals([call?.role, call?.toolCall?.name, afterTool.at(-1)?.role], [
    'assistant',
    'confirm_identity',
    'tool',
  ]);
  assertEquals(afterTool.at(-1)?.toolCallId, call?.toolCall?.id);
  assertEquals(JSON.stringify(result.transcript).includes('TOOL REPLY'), false);
});

Deno.test('conversation › the shopkeeper hanging up ends the call', async () => {
  const result = await converse(GREETING, {
    asha: scripted([]),
    shopkeeper: scripted([shop('Wrong number.', true)]),
    runTool: tools([]),
  });
  assertEquals([result.end, result.transcript.length], ['shopkeeper_hung_up', 2]);
});

Deno.test('conversation › stops after 10 shopkeeper turns', async () => {
  const many = Array.from({ length: 20 }, (_, n) => `line ${n}`);
  const result = await converse(GREETING, {
    asha: scripted(many.map((line) => asha(line))),
    shopkeeper: scripted(many.map((line) => shop(line))),
    runTool: tools([]),
  });
  assertEquals(result.end, 'max_turns');
  assertEquals(result.transcript.filter((t) => t.role === 'user').length, MAX_TURNS);
});

Deno.test('conversation › a failed or unusable model answer ends the call', async () => {
  const ashaFails = await converse(GREETING, {
    asha: scripted(['{"say": broken']),
    shopkeeper: scripted([shop('Yes.')]),
    runTool: tools([]),
  });
  assertEquals(ashaFails.end, 'asha_failed');
  const ashaSilent = await converse(GREETING, {
    asha: scripted([null]),
    shopkeeper: scripted([shop('Yes.')]),
    runTool: tools([]),
  });
  assertEquals(ashaSilent.end, 'asha_failed');
  const shopFails = await converse(GREETING, {
    asha: scripted([]),
    shopkeeper: scripted([null]),
    runTool: tools([]),
  });
  assertEquals(shopFails.end, 'shopkeeper_failed');
});

Deno.test('conversation › at most 3 tools in a row; then Asha must speak', async () => {
  const calls: string[] = [];
  const step = (n: number): string => asha('', { tool: { name: 'get_dues', args: { n } } });
  const result = await converse(GREETING, {
    asha: scripted([step(1), step(2), step(3), step(4)]),
    shopkeeper: scripted([shop('Yes.')]),
    runTool: tools(calls),
  });
  assertEquals(calls.length, MAX_TOOL_STEPS);
  assertEquals(result.end, 'asha_failed');
});

Deno.test('conversation › a repeated tool call gets the earlier reply and does not run again', async () => {
  const calls: string[] = [];
  const seen: ChatMessage[][] = [];
  const save = asha('', { tool: { name: 'log_promise', args: { amount: 2000 } } });
  const result = await converse(GREETING, {
    asha: scripted([save, save, asha('Saved: 2,000 rupees. Goodbye.', { end_call: true })], seen),
    shopkeeper: scripted([shop('2000 on Saturday.')]),
    runTool: tools(calls),
  });
  assertEquals([calls, result.toolCalls, result.end], [['log_promise'], 1, 'asha_ended']);
  const last = seen[2] ?? [];
  assertEquals(last.at(-1)?.content, last.at(-3)?.content);
  assertEquals(last.at(-1)?.toolCallId, last.at(-2)?.toolCall?.id);
  assertEquals(last.at(-1)?.toolCallId === last.at(-3)?.toolCallId, false);
});

/** Like tools(), but each call's result comes from the list (the last one repeats). */
function toolResults(
  calls: string[],
  results: readonly ToolResult[],
): (name: string, args: unknown) => Promise<ToolResult> {
  return (name) => {
    const result = results[Math.min(calls.length, results.length - 1)];
    calls.push(name);
    return Promise.resolve(result ?? { ok: true, say: 'done', data: {} });
  };
}

const REFUSED: ToolResult = { ok: false, code: 'IDENTITY_NOT_CONFIRMED', say: 'Confirm first.' };
const DONE: ToolResult = { ok: true, say: 'done', data: {} };

Deno.test('conversation › a failed tool reply is never reused: the same call runs again', async () => {
  const calls: string[] = [];
  const dues = asha('', { tool: { name: 'get_dues', args: {} } });
  const result = await converse(GREETING, {
    asha: scripted([dues, dues, asha('You owe 8,500 rupees. Goodbye.', { end_call: true })]),
    shopkeeper: scripted([shop('Yes, I am Ramesh.')]),
    runTool: toolResults(calls, [REFUSED, DONE]),
  });
  assertEquals([calls, result.toolCalls], [['get_dues', 'get_dues'], 2]);
});

Deno.test('conversation › the same tool after the shopkeeper speaks runs again (e.g. "unsure" twice)', async () => {
  const calls: string[] = [];
  const unsure = asha('', { tool: { name: 'confirm_identity', args: { answer: 'unsure' } } });
  const result = await converse(GREETING, {
    asha: scripted([
      unsure,
      asha('Sorry, is this Ramesh garu?'),
      unsure,
      asha('Goodbye.', {
        end_call: true,
      }),
    ]),
    shopkeeper: scripted([shop('Who?'), shop('Hmm?')]),
    runTool: tools(calls),
  });
  assertEquals(calls, ['confirm_identity', 'confirm_identity']);
  assertEquals(result.end, 'asha_ended');
});

Deno.test('conversation › promise A, then B, then A again: all three are saved', async () => {
  const calls: string[] = [];
  const promise = (amount: number): string =>
    asha('', { tool: { name: 'log_promise', args: { amount } } });
  const result = await converse(GREETING, {
    asha: scripted([
      promise(2000),
      promise(3000),
      promise(2000),
      asha('Goodbye.', {
        end_call: true,
      }),
    ]),
    shopkeeper: scripted([shop('2000, no 3000, no 2000.')]),
    runTool: tools(calls),
  });
  assertEquals([calls.length, result.toolCalls], [3, 3]);
});

Deno.test('conversation › a tool sent with the goodbye still runs', async () => {
  const calls: string[] = [];
  const goodbye = asha('Srinivas garu will call you. Goodbye.', {
    tool: {
      name: 'request_owner_callback',
      args: { reason: 'dispute', summary: 'Disputes amount' },
    },
    end_call: true,
  });
  const result = await converse(GREETING, {
    asha: scripted([goodbye]),
    shopkeeper: scripted([shop('The amount is wrong.')]),
    runTool: tools(calls),
  });
  assertEquals([result.end, calls], ['asha_ended', ['request_owner_callback']]);
});
