// supabase/functions/_shared/brain/llm.test.ts
// Fake fetch only (testing.md: no real LLM in unit tests).
import { assert, assertEquals } from '@std/assert';
import type { LogFields, Logger } from '../log.ts';
import { createBrainLlm, GEMINI_URL, SARVAM_BRAIN_MODEL, SARVAM_CHAT_URL } from './llm.ts';

const NOW = new Date('2026-11-02T12:00:00+05:30');
const MESSAGE = 'రమేష్ 2000 కట్టాడు';
const PAID = '{"intent":"mark_paid","name":"Ramesh","amount":2000}';

type Answer = Response | Error;

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

function sarvamOk(content: string | null): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
}

function geminiOk(text: string): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
}

function setup(sarvam: Answer, gemini: Answer): {
  llm: ReturnType<typeof createBrainLlm>;
  calls: Call[];
  logs: LogFields[];
} {
  const calls: Call[] = [];
  const logs: LogFields[] = [];
  function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = String(input);
    calls.push({
      url,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const answer = url === SARVAM_CHAT_URL ? sarvam : gemini;
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  }
  const log: Logger = (_level, _event, fields = {}) => logs.push(fields);
  const llm = createBrainLlm({
    sarvamApiKey: 'sarvam-key',
    geminiApiKey: 'gemini-key',
    fetchImpl: fakeFetch,
    log,
  });
  return { llm, calls, logs };
}

Deno.test('llm › a valid Sarvam answer is used and Gemini is not called', async () => {
  const { llm, calls } = setup(sarvamOk(PAID), geminiOk('{}'));
  const result = await llm(MESSAGE, NOW);
  assertEquals(result, {
    path: 'sarvam',
    suggestion: { intent: 'mark_paid', name: 'Ramesh', amount: 2000 },
  });
  assertEquals(calls.length, 1);
});

Deno.test('llm › Sarvam gets the model, key header, reasoning off and the dated prompt', async () => {
  const { llm, calls } = setup(sarvamOk(PAID), geminiOk('{}'));
  await llm(MESSAGE, NOW);
  const body = calls[0]?.body ?? {};
  assertEquals([body['model'], body['reasoning_effort'], body['temperature']], [
    SARVAM_BRAIN_MODEL,
    null,
    0,
  ]);
  assertEquals(calls[0]?.headers['api-subscription-key'], 'sarvam-key');
  const messages = body['messages'] as Array<{ content: string }>;
  assert(messages[0]?.content.includes('Monday, 2026-11-02'));
  assertEquals(messages[1]?.content, MESSAGE);
});

Deno.test('llm › bad JSON from Sarvam falls back to Gemini', async () => {
  const { llm, calls } = setup(sarvamOk('Ramesh paid, I think.'), geminiOk(PAID));
  const result = await llm(MESSAGE, NOW);
  assertEquals(result.path, 'gemini');
  assertEquals(calls[1]?.url, GEMINI_URL);
  assertEquals(calls[1]?.headers['x-goog-api-key'], 'gemini-key');
});

Deno.test('llm › a Sarvam HTTP error, timeout or empty answer falls back to Gemini', async () => {
  const answers = [
    new Response('{}', { status: 500 }),
    new DOMException('timed out', 'TimeoutError'),
    sarvamOk(null),
    new Response('{"unexpected":true}'),
  ];
  for (const sarvam of answers) {
    const { llm } = setup(sarvam, geminiOk(PAID));
    assertEquals((await llm(MESSAGE, NOW)).path, 'gemini');
  }
});

Deno.test('llm › both failing gives "failed" with no suggestion', async () => {
  const { llm } = setup(new Response('{}', { status: 503 }), new TypeError('network down'));
  assertEquals(await llm(MESSAGE, NOW), { suggestion: null, path: 'failed' });
});

Deno.test('llm › logs carry provider and outcome, never the message or the answer', async () => {
  const { llm, logs } = setup(sarvamOk('garbage'), geminiOk(PAID));
  await llm(MESSAGE, NOW);
  const logged = JSON.stringify(logs);
  assert(logged.includes('bad_json') && logged.includes('gemini'));
  assert(!logged.includes('Ramesh') && !logged.includes('2000') && !logged.includes('రమేష్'));
});

Deno.test('llm › Gemini text split over parts (some empty) is joined', async () => {
  const split = new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{}, { text: PAID }] } }] }),
  );
  const { llm } = setup(new Response('{}', { status: 500 }), split);
  assertEquals((await llm(MESSAGE, NOW)).path, 'gemini');
});

Deno.test('llm › a non-Error failure is logged as unknown', async () => {
  const { llm, logs } = setup(new Response('{}', { status: 500 }), geminiOk('{}'));
  const failing = createBrainLlm({
    sarvamApiKey: 'k',
    geminiApiKey: 'k',
    fetchImpl: () => Promise.reject('offline'),
    log: (_level, _event, fields = {}) => logs.push(fields),
  });
  await llm(MESSAGE, NOW);
  assertEquals((await failing(MESSAGE, NOW)).path, 'failed');
  assert(JSON.stringify(logs).includes('"outcome":"unknown"'));
});
