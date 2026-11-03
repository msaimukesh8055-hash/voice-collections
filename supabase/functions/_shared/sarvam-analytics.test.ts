// supabase/functions/_shared/sarvam-analytics.test.ts
// Fake fetch only. Shapes match the read-only GETs made on 2026-11-03 (M5 5a build).
import { assert, assertEquals } from '@std/assert';
import type { LogFields } from './log.ts';
import {
  type AnalyticsConfig,
  createTranscriptClient,
  isInteractionId,
  MAX_TURN_CHARS,
  SARVAM_ANALYTICS_BASE,
} from './sarvam-analytics.ts';

const INTERACTION = '20261102/182f511f-21:45:10-8bfe8bd5';
const TOKEN = 'ca000000-0000-4000-8000-0000000000aa';

interface Seen {
  readonly url: string;
  readonly headers: Record<string, string>;
}

interface AnalyticsSetup {
  readonly client: ReturnType<typeof createTranscriptClient>;
  readonly seen: Seen[];
  readonly logs: LogFields[];
}

function setup(
  answer: Response | Error,
  overrides: Partial<AnalyticsConfig> = {},
): AnalyticsSetup {
  const seen: Seen[] = [];
  const logs: LogFields[] = [];
  function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    seen.push({ url: String(input), headers: init?.headers as Record<string, string> });
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  }
  const client = createTranscriptClient({
    apiKey: 'agents-key',
    orgId: 'org-1',
    workspaceId: 'ws-1',
    appId: 'app-1',
    fetchImpl: fakeFetch,
    log: (_level, _event, fields = {}) => logs.push(fields),
    ...overrides,
  });
  return { client, seen, logs };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const TRANSCRIPT = {
  interaction_id: INTERACTION,
  messages: [
    { turn_id: 1, role: 'assistant', content: 'Namaste, I am Asha.', language_name: 'en-IN' },
    {
      turn_id: 2,
      role: 'user',
      content: '  Haan, Ramesh bol raha hoon.  ',
      language_name: 'hi-IN',
    },
    { turn_id: 3, role: 'tool', content: '{"ok":true}', language_name: 'en-IN' },
    { turn_id: 4, role: 'user', content: '   ', language_name: 'en-IN' },
  ],
};

Deno.test('transcript › found → assistant and user turns, trimmed, in order', async () => {
  const { client, seen } = setup(json(TRANSCRIPT));
  const result = await client.fetchTranscript(INTERACTION);
  assertEquals(result, {
    kind: 'ready',
    turns: [
      { role: 'assistant', content: 'Namaste, I am Asha.' },
      { role: 'user', content: 'Haan, Ramesh bol raha hoon.' },
    ],
  });
  assertEquals(
    seen[0]?.url,
    `${SARVAM_ANALYTICS_BASE}/org-1/ws-1/app-1/transcripts/${INTERACTION}`,
  );
  assertEquals(seen[0]?.headers['X-API-Key'], 'agents-key');
});

Deno.test('transcript › long turns are capped', async () => {
  const long = { ...TRANSCRIPT, messages: [{ role: 'user', content: 'x'.repeat(5000) }] };
  const result = await setup(json(long)).client.fetchTranscript(INTERACTION);
  assert(result.kind === 'ready');
  assertEquals(result.turns[0]?.content.length, MAX_TURN_CHARS);
});

Deno.test('transcript › lagging (404 or no messages yet) → not ready', async () => {
  for (const answer of [json({ detail: 'nope' }, 404), json({ messages: [] })]) {
    assertEquals(await setup(answer).client.fetchTranscript(INTERACTION), { kind: 'not_ready' });
  }
});

Deno.test('transcript › server error, odd shape or network failure → failed, logged safely', async () => {
  const answers = [
    json({}, 500),
    json({ unexpected: true }),
    new TypeError('network down'),
    new Response('not json'),
  ];
  for (const answer of answers) {
    const { client, logs } = setup(answer);
    const result = await client.fetchTranscript(INTERACTION);
    assertEquals(result.kind, 'failed');
    assertEquals(JSON.stringify(logs).includes('agents-key'), false);
  }
});

Deno.test('transcript › a non-Error rejection is still a failure', async () => {
  const { client } = setup(new Response('{}'), {
    fetchImpl: () => Promise.reject('offline'),
  });
  assertEquals(await client.fetchTranscript(INTERACTION), { kind: 'failed', reason: 'unknown' });
});

Deno.test('transcript › no app id or a malformed interaction id → failed without a request', async () => {
  const noApp = setup(json(TRANSCRIPT), { appId: null });
  assertEquals(await noApp.client.fetchTranscript(INTERACTION), {
    kind: 'failed',
    reason: 'not_configured',
  });
  const bad = setup(json(TRANSCRIPT));
  assertEquals((await bad.client.fetchTranscript('../../secrets')).kind, 'failed');
  assertEquals([noApp.seen.length, bad.seen.length], [0, 0]);
});

Deno.test('interaction ids › Sarvam ids pass; path tricks do not', () => {
  assertEquals(isInteractionId(INTERACTION), true);
  assertEquals(isInteractionId('20261102/a/../b'), false);
  assertEquals(isInteractionId('a?b=c'), false);
  assertEquals(isInteractionId(''), false);
});

const LIST = {
  items: [
    { interaction_id: '20261102/other', agent_variables: { call_token: 'someone-else' } },
    { interaction_id: INTERACTION, agent_variables: { call_token: TOKEN, user_name: 'x' } },
    { interaction_id: '20261102/none' },
  ],
  total: 3,
};

Deno.test('find interaction › matches the call token in the agent variables', async () => {
  const { client, seen } = setup(json(LIST));
  const window = { from: new Date('2026-11-02T16:00:00Z'), to: new Date('2026-11-02T16:20:00Z') };
  assertEquals(await client.findInteractionId(TOKEN, window), INTERACTION);
  const url = new URL(seen[0]?.url ?? '');
  assertEquals(url.pathname.endsWith('/org-1/ws-1/app-1/interactions'), true);
  assertEquals(url.searchParams.get('start_datetime'), '2026-11-02T16:00:00.000Z');
  assertEquals(url.searchParams.get('end_datetime'), '2026-11-02T16:20:00.000Z');
});

Deno.test('find interaction › no match, an error or no app id → null', async () => {
  const window = { from: new Date(0), to: new Date(1) };
  const answers = [json({ items: [] }), json({}, 500), new TypeError('down'), json({ x: 1 })];
  for (const answer of answers) {
    assertEquals(await setup(answer).client.findInteractionId(TOKEN, window), null);
  }
  assertEquals(
    await setup(json(LIST), { appId: null }).client.findInteractionId(TOKEN, window),
    null,
  );
});
