// supabase/functions/_shared/simulator/owner-conversation.test.ts
// Munshi ↔ owner text conversation (M8 C1, fake models): owner lines reach Munshi as "OWNER:",
// the timeline keeps owner lines, Munshi moves and tool runs in order with simulated times, the
// end reasons are Munshi's, and the 12-turn cap holds.
import { assertEquals } from '@std/assert';
import type { ChatMessage } from '../llm/json-llm.ts';
import type { ToolResult } from '../tools/types.ts';
import type { ChatFn } from './conversation.ts';
import {
  converseOwner,
  MAX_OWNER_TURNS,
  MUNSHI_MOVE_MS,
  OWNER_LINE_MS,
  type OwnerCallEvent,
  TOOL_RUN_MS,
} from './owner-conversation.ts';

const START = new Date('2026-11-07T06:30:00.000Z');

function scripted(answers: readonly (string | null)[], seen: ChatMessage[][] = []): ChatFn {
  let next = 0;
  return (messages) => {
    seen.push([...messages]);
    const answer = answers[next] ?? null;
    next += 1;
    return Promise.resolve(answer);
  };
}

function munshi(say: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ say, tool: null, end_call: false, ...extra });
}

function owner(say: string, hangUp = false): string {
  return JSON.stringify({ say, hang_up: hangUp });
}

function okTool(times: Date[]): (name: string, args: unknown, at: Date) => Promise<ToolResult> {
  return (name, _args, at) => {
    times.push(at);
    return Promise.resolve({ ok: true, say: `${name}: 8,500 rupees pending`, data: {} });
  };
}

function kinds(events: readonly OwnerCallEvent[]): string[] {
  return events.map((event) => event.kind);
}

Deno.test('owner conversation › timeline in order with simulated times; Munshi ends', async () => {
  const seen: ChatMessage[][] = [];
  const times: Date[] = [];
  const result = await converseOwner('హా Srinivas అన్నా', {
    munshi: scripted([
      munshi('', { tool: { name: 'book_summary', args: { focus: 'overview' } } }),
      munshi('8,500 pending. Anything else?'),
      munshi('Bye!', { end_call: true }),
    ], seen),
    owner: scripted([owner('How much is pending?'), owner('No, bye.')]),
    runTool: okTool(times),
    startAt: START,
  });
  assertEquals(result.end, 'munshi_ended');
  assertEquals(kinds(result.events), ['owner', 'munshi', 'tool', 'munshi', 'owner', 'munshi']);
  assertEquals(seen[0]?.at(-1)?.content, 'OWNER: How much is pending?');
  const toolAt = START.getTime() + OWNER_LINE_MS + MUNSHI_MOVE_MS + TOOL_RUN_MS;
  assertEquals(times.map((time) => time.getTime()), [toolAt]);
  const tool = result.events[2];
  assertEquals(tool?.kind === 'tool' ? [tool.name, tool.at] : [], [
    'book_summary',
    new Date(toolAt).toISOString(),
  ]);
});

Deno.test('owner conversation › a prepare and a confirm in one Munshi turn are < 2 s apart', async () => {
  const times: Date[] = [];
  await converseOwner('hi', {
    munshi: scripted([
      munshi('', { tool: { name: 'prepare_credit', args: { name: 'Ramesh', amount: 5000 } } }),
      munshi('', { tool: { name: 'confirm_action', args: { action_ref: 'r1' } } }),
      munshi('Done.'),
    ]),
    owner: scripted([owner('Add 5000 for Ramesh.')]),
    runTool: okTool(times),
    startAt: START,
  });
  const [prepare, confirm] = times.map((time) => time.getTime());
  assertEquals((confirm ?? 0) - (prepare ?? 0), MUNSHI_MOVE_MS + TOOL_RUN_MS);
});

Deno.test('owner conversation › hang-up, failures; unusable lines are not recorded', async () => {
  const hungUp = await converseOwner('hi', {
    munshi: scripted([]),
    owner: scripted([owner('Bye.', true)]),
    runTool: okTool([]),
    startAt: START,
  });
  assertEquals([hungUp.end, kinds(hungUp.events)], ['owner_hung_up', ['owner']]);
  const failed = await converseOwner('hi', {
    munshi: scripted([]),
    owner: scripted([null]),
    runTool: okTool([]),
    startAt: START,
  });
  assertEquals([failed.end, failed.events.length], ['owner_failed', 0]);
  const broken = await converseOwner('hi', {
    munshi: scripted(['{"say": broken']),
    owner: scripted([owner('Hello?')]),
    runTool: okTool([]),
    startAt: START,
  });
  assertEquals([broken.end, kinds(broken.events)], ['munshi_failed', ['owner']]);
  const silent = await converseOwner('hi', {
    munshi: scripted([null]),
    owner: scripted([owner('Hello?')]),
    runTool: okTool([]),
    startAt: START,
  });
  assertEquals(silent.end, 'munshi_failed');
});

Deno.test('owner conversation › stops after 12 owner lines', async () => {
  const many = Array.from({ length: 30 }, (_, n) => `line ${n}`);
  const result = await converseOwner('hi', {
    munshi: scripted(many.map((line) => munshi(line))),
    owner: scripted(many.map((line) => owner(line))),
    runTool: okTool([]),
    startAt: START,
  });
  assertEquals(result.end, 'max_turns');
  assertEquals(result.events.filter((event) => event.kind === 'owner').length, MAX_OWNER_TURNS);
});
