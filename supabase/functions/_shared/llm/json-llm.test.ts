// supabase/functions/_shared/llm/json-llm.test.ts
// Multi-turn chat requests (M5 simulated calls): exact request bodies, with a fake fetch only.
import { assertEquals, assertRejects } from '@std/assert';
import { askGeminiChat, askSarvamChat, type ChatRequest, type JsonLlmConfig } from './json-llm.ts';

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function config(
  reply: unknown,
  status = 200,
): { config: JsonLlmConfig; seen: Captured[] } {
  const seen: Captured[] = [];
  function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    seen.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return Promise.resolve(Response.json(reply, { status }));
  }
  return {
    config: { sarvamApiKey: 'sk', geminiApiKey: 'gk', fetchImpl: fakeFetch, log: () => {} },
    seen,
  };
}

const REQUEST: ChatRequest = {
  system: 'You are Asha.',
  messages: [
    { role: 'user', content: '(connected)' },
    { role: 'assistant', content: '{"say":"Namaste"}' },
    { role: 'user', content: 'SHOPKEEPER: yes' },
  ],
  maxTokens: 200,
  temperature: 0.4,
};

Deno.test('chat › Sarvam gets the system line first, then the turns, at the given temperature', async () => {
  const { config: c, seen } = config({ choices: [{ message: { content: '{"say":"ok"}' } }] });
  assertEquals(await askSarvamChat(c, REQUEST), '{"say":"ok"}');
  assertEquals(seen[0]?.body.messages, [
    { role: 'system', content: 'You are Asha.' },
    ...REQUEST.messages,
  ]);
  assertEquals([seen[0]?.body.temperature, seen[0]?.body.max_tokens], [0.4, 200]);
});

Deno.test('chat › Gemini calls its own turns "model"', async () => {
  const reply = { candidates: [{ content: { parts: [{ text: '{"say":"hm"}' }] } }] };
  const { config: c, seen } = config(reply);
  assertEquals(await askGeminiChat(c, REQUEST), '{"say":"hm"}');
  const contents = seen[0]?.body.contents as { role: string }[];
  assertEquals(contents.map((content) => content.role), ['user', 'model', 'user']);
  assertEquals((seen[0]?.body.generationConfig as { temperature: number }).temperature, 0.4);
  assertEquals(seen[0]?.headers['x-goog-api-key'], 'gk');
});

Deno.test('chat › an HTTP error throws (the caller decides what it means)', async () => {
  const { config: c } = config({}, 429);
  await assertRejects(() => askGeminiChat(c, REQUEST));
  await assertRejects(() => askSarvamChat(c, REQUEST));
});

Deno.test('chat › a null Sarvam content is an empty answer', async () => {
  const { config: c } = config({ choices: [{ message: { content: null } }] });
  assertEquals(await askSarvamChat(c, { ...REQUEST, temperature: undefined }), '');
});

const TOOL = { name: 'get_dues', description: 'Dues.', parameters: { type: 'object' } };

Deno.test('chat › declared tools go to Sarvam in its function format; none means no tools field', async () => {
  const reply = { choices: [{ message: { content: '{"say":"ok"}' } }] };
  const { config: c, seen } = config(reply);
  await askSarvamChat(c, { ...REQUEST, tools: [TOOL] });
  await askSarvamChat(c, REQUEST);
  assertEquals(seen[0]?.body.tools, [{
    type: 'function',
    function: { name: 'get_dues', description: 'Dues.', parameters: { type: 'object' } },
  }]);
  assertEquals('tools' in (seen[1]?.body ?? {}), false);
});

Deno.test('chat › a native Sarvam tool call comes back as a move with that tool', async () => {
  const call = { function: { name: 'confirm_identity', arguments: '{"answer":"confirmed"}' } };
  const { config: c } = config({ choices: [{ message: { content: null, tool_calls: [call] } }] });
  assertEquals(
    JSON.parse(await askSarvamChat(c, { ...REQUEST, tools: [TOOL] })),
    { say: '', tool: { name: 'confirm_identity', args: { answer: 'confirmed' } }, end_call: false },
  );
});

Deno.test('chat › a native tool call keeps spoken words and survives bad arguments', async () => {
  const call = { function: { name: 'get_dues', arguments: 'not json' } };
  const reply = { choices: [{ message: { content: 'One moment.', tool_calls: [call] } }] };
  const { config: c } = config(reply);
  assertEquals(
    JSON.parse(await askSarvamChat(c, REQUEST)),
    { say: 'One moment.', tool: { name: 'get_dues', args: {} }, end_call: false },
  );
});

Deno.test('chat › missing tool arguments count as none', async () => {
  const call = { function: { name: 'get_dues', arguments: null } };
  const { config: c } = config({ choices: [{ message: { content: null, tool_calls: [call] } }] });
  assertEquals(JSON.parse(await askSarvamChat(c, REQUEST)).tool, { name: 'get_dues', args: {} });
});

Deno.test('chat › tool turns go to Sarvam in its native shape', async () => {
  const { config: c, seen } = config({ choices: [{ message: { content: '{"say":"ok"}' } }] });
  const toolCall = { id: 'call_1', name: 'get_dues', args: {} };
  await askSarvamChat(c, {
    ...REQUEST,
    messages: [
      { role: 'assistant', content: '', toolCall },
      { role: 'tool', content: 'TOOL REPLY get_dues: {}', toolCallId: 'call_1' },
      { role: 'assistant', content: 'One moment.', toolCall },
    ],
  });
  const fn = { name: 'get_dues', arguments: '{}' };
  assertEquals((seen[0]?.body.messages as unknown[]).slice(1), [
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: fn }],
    },
    { role: 'tool', tool_call_id: 'call_1', content: 'TOOL REPLY get_dues: {}' },
    {
      role: 'assistant',
      content: 'One moment.',
      tool_calls: [{ id: 'call_1', type: 'function', function: fn }],
    },
  ]);
});
