// supabase/functions/_shared/llm/json-llm.test.ts
// Multi-turn chat requests (M5 simulated calls): exact request bodies, with a fake fetch only.
import { assertEquals, assertRejects } from '@std/assert';
import { askGeminiChat, askSarvamChat, type ChatRequest } from './json-llm.ts';

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function config(
  reply: unknown,
  status = 200,
): { config: Parameters<typeof askSarvamChat>[0]; seen: Captured[] } {
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
