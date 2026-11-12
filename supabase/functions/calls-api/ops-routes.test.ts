// supabase/functions/calls-api/ops-routes.test.ts
// The ops page's API (M9 Build A) through the real router: the link check (security, 100%), the
// summary with spend priced in rupees, and one trace's steps.
import { assertEquals } from '@std/assert';
import { DASHBOARD_TOKEN_HEADER, signDashboardToken } from '../_shared/auth/dashboard-link.ts';
import { EMPTY_OPS_SUMMARY, type FakeOpsState } from '../_shared/db/fake-ops-repository.ts';
import type { OpsSummary, TraceStep } from '../_shared/db/ops-repository.ts';
import { createFakeRepository, FAKE_NOW } from '../_shared/db/fake-repository.ts';
import { handleCallsApi } from './handler.ts';
import { dashboardSetup, LINK_SECRET } from './__fixtures__/dashboard.ts';
import { munshiSetup } from './__fixtures__/munshi.ts';
import type { CallsApiDeps } from './types.ts';

const BASE = 'https://ref.supabase.co/functions/v1/calls-api';
const TRACE_ID = '55555555-5555-4555-8555-555555555555';

const STEP: TraceStep = {
  source: 'whatsapp-webhook',
  step: 'brain_llm',
  status: 'warn',
  errorCode: 'bad_json',
  provider: 'sarvam',
  durationMs: 412,
  tokensIn: null,
  tokensOut: null,
  detail: { provider: 'sarvam', outcome: 'bad_json', ms: 412 },
  createdAt: '2026-11-11T05:00:00.000Z',
};

const SUMMARY: OpsSummary = {
  ...EMPTY_OPS_SUMMARY,
  day: { requests: 40, failed: 2 },
  tokens: [
    {
      provider: 'sarvam',
      today: { input: 100_000, output: 10_000 },
      month: { input: 1_000_000, output: 100_000 },
    },
    {
      provider: 'gemini',
      today: { input: 900_000, output: 900_000 },
      month: { input: 900_000, output: 900_000 },
    },
  ],
  voice: {
    today: { liveMinutes: 2, simulatedCalls: 3 },
    month: { liveMinutes: 10, simulatedCalls: 12 },
  },
};

function deps(ops: Partial<FakeOpsState>, publicDemo = false): CallsApiDeps {
  const { dashboard } = dashboardSetup({ ops });
  return {
    repo: createFakeRepository().repo,
    clock: () => FAKE_NOW,
    log: () => {},
    allowedOrigins: [],
    sarvam: { apiKey: 'k', orgId: 'o', workspaceId: 'w', appId: 'a', munshiAppId: null },
    fetchImpl: () => Promise.reject(new Error('no network in tests')),
    kickFollowup: () => 0,
    dashboard: { ...dashboard, publicDemo },
    munshi: munshiSetup().munshi,
  };
}

async function get(
  path: string,
  all: CallsApiDeps,
  token?: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const value = token === undefined ? await signDashboardToken(LINK_SECRET, FAKE_NOW) : token;
  const headers: Record<string, string> = value === null ? {} : { [DASHBOARD_TOKEN_HEADER]: value };
  const response = await handleCallsApi(new Request(`${BASE}${path}`, { headers }), all);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

Deno.test('ops routes › without a valid link: 401 and no data, on both routes', async () => {
  const all = deps({ summary: SUMMARY, traces: { [TRACE_ID]: [STEP] } });
  for (const path of ['/v1/dashboard/ops', `/v1/dashboard/ops/traces/${TRACE_ID}`]) {
    for (const token of [null, 'forged.token']) {
      const { status, body } = await get(path, all, token);
      assertEquals(status, 401);
      assertEquals(Object.keys(body), ['error']);
    }
  }
});

Deno.test('ops routes › the public demo opens both routes without a link', async () => {
  const all = deps({ summary: SUMMARY, traces: { [TRACE_ID]: [STEP] } }, true);
  assertEquals((await get('/v1/dashboard/ops', all, null)).status, 200);
  assertEquals((await get(`/v1/dashboard/ops/traces/${TRACE_ID}`, all, null)).status, 200);
});

Deno.test('ops routes › the summary comes with spend in rupees against the cap', async () => {
  const { status, body } = await get('/v1/dashboard/ops', deps({ summary: SUMMARY }));
  assertEquals(status, 200);
  assertEquals(body.day, { requests: 40, failed: 2 });
  assertEquals(body.toolTargetMs, 500);
  assertEquals(body.generatedAt, FAKE_NOW.toISOString());
  // Voice: 2 and 10 minutes at ₹4.13. Sarvam tokens with GST; Gemini is free.
  assertEquals(body.spend, {
    capInr: 1000,
    today: { voiceInr: 8.26, llmInr: 4.32, totalInr: 12.58 },
    month: { voiceInr: 41.3, llmInr: 43.19, totalInr: 84.49 },
  });
});

Deno.test('ops routes › nothing recorded yet gives zeros, not an error', async () => {
  const { status, body } = await get('/v1/dashboard/ops', deps({}));
  assertEquals(status, 200);
  assertEquals((body.spend as { today: unknown }).today, { voiceInr: 0, llmInr: 0, totalInr: 0 });
  assertEquals(body.recentErrors, []);
});

Deno.test('ops routes › a trace returns its steps in order', async () => {
  const later = { ...STEP, step: 'request', createdAt: '2026-11-11T05:00:01.000Z' };
  const all = deps({ traces: { [TRACE_ID]: [STEP, later] } });
  const { status, body } = await get(`/v1/dashboard/ops/traces/${TRACE_ID}`, all);
  assertEquals(status, 200);
  assertEquals(body, { traceId: TRACE_ID, steps: [STEP, later] });
});

Deno.test('ops routes › an unknown trace or an id that is not a UUID gives 404', async () => {
  const all = deps({ traces: { [TRACE_ID]: [STEP] } });
  const unknown = '66666666-6666-4666-8666-666666666666';
  assertEquals((await get(`/v1/dashboard/ops/traces/${unknown}`, all)).status, 404);
  assertEquals((await get('/v1/dashboard/ops/traces/not-a-uuid', all)).status, 404);
  assertEquals((await get('/v1/dashboard/ops/traces/1%27%20or%201=1', all)).status, 404);
});

Deno.test('ops routes › latest errors: one row per failed request, named by what broke', async () => {
  const other = '77777777-7777-4777-8777-777777777777';
  const at = '2026-11-11T05:00:00.000Z';
  const recentErrors = [
    { traceId: TRACE_ID, source: 'drill', step: 'request', errorCode: 'HTTP 500', createdAt: at },
    { traceId: TRACE_ID, source: 'drill', step: 'card_save_failed', errorCode: 'X', createdAt: at },
    { traceId: other, source: 'calls-api', step: 'request', errorCode: 'HTTP 500', createdAt: at },
  ];
  const { body } = await get('/v1/dashboard/ops', deps({ summary: { ...SUMMARY, recentErrors } }));
  assertEquals(body.recentErrors, [recentErrors[1], recentErrors[2]]);
});

Deno.test('ops routes › all five functions are always listed, quiet ones with zeros', async () => {
  const sources = [
    { source: 'drill', requests: 1, failed: 1, p95Ms: 130 },
    { source: 'calls-api', requests: 22, failed: 0, p95Ms: 900 },
  ];
  const { body } = await get('/v1/dashboard/ops', deps({ summary: { ...SUMMARY, sources } }));
  const quiet = { requests: 0, failed: 0, p95Ms: null };
  assertEquals(body.sources, [
    { source: 'whatsapp-webhook', ...quiet },
    { source: 'sarvam-tools', ...quiet },
    { source: 'munshi-tools', ...quiet },
    { source: 'calls-api', requests: 22, failed: 0, p95Ms: 900 },
    { source: 'followup-worker', ...quiet },
    { source: 'drill', requests: 1, failed: 1, p95Ms: 130 },
  ]);
});

Deno.test('ops routes › says whether reminder calls are paused (M9 pause switch)', async () => {
  const running = await get('/v1/dashboard/ops', deps({ summary: SUMMARY }));
  assertEquals(running.body.callsPaused, false);
  const all = deps({ summary: SUMMARY });
  const settings = await all.repo.getDemoSettings();
  const paused: CallsApiDeps = {
    ...all,
    repo: {
      ...all.repo,
      getDemoSettings: () => Promise.resolve({ ...settings, callsPaused: true }),
    },
  };
  assertEquals((await get('/v1/dashboard/ops', paused)).body.callsPaused, true);
});
