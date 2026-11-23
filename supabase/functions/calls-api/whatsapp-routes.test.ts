// supabase/functions/calls-api/whatsapp-routes.test.ts
// GET /v1/dashboard/whatsapp[/:id] through the real router (ADR-0022): behind the dashboard link,
// each exchange with its verdict, one exchange with its scorecard, 404 for an unknown id.
import { assert, assertEquals } from '@std/assert';
import { DASHBOARD_TOKEN_HEADER, signDashboardToken } from '../_shared/auth/dashboard-link.ts';
import { fakeExchange } from '../_shared/db/fake-exchange-reads.ts';
import type { TraceStep } from '../_shared/db/ops-repository.ts';
import { createFakeRepository, FAKE_NOW } from '../_shared/db/fake-repository.ts';
import { dashboardSetup, LINK_SECRET } from './__fixtures__/dashboard.ts';
import { munshiSetup } from './__fixtures__/munshi.ts';
import { handleCallsApi } from './handler.ts';
import type { CallsApiDeps } from './types.ts';

const ORIGIN = 'http://localhost:5173';
const BASE = 'https://ref.supabase.co/functions/v1/calls-api';
const LOST = fakeExchange({
  id: 'e0000000-0000-4000-8000-000000000002',
  path: 'failed',
  command: 'unknown',
  cardActionId: null,
  card: null,
});

function deps(
  dashboard = dashboardSetup({ exchanges: [fakeExchange(), LOST] }).dashboard,
): CallsApiDeps {
  return {
    repo: createFakeRepository().repo,
    clock: () => FAKE_NOW,
    log: () => {},
    allowedOrigins: [ORIGIN],
    sarvam: { apiKey: 'k', orgId: 'o', workspaceId: 'w', appId: 'a', munshiAppId: null },
    fetchImpl: () => Promise.reject(new Error('no network in tests')),
    kickFollowup: () => 0,
    dashboard,
    munshi: munshiSetup().munshi,
  };
}

async function get(path: string, signed = true, all = deps()): Promise<Response> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (signed) headers[DASHBOARD_TOKEN_HEADER] = await signDashboardToken(LINK_SECRET, FAKE_NOW);
  return handleCallsApi(new Request(`${BASE}${path}`, { headers }), all);
}

Deno.test('whatsapp api › no valid dashboard link → 401', async () => {
  const response = await get('/v1/dashboard/whatsapp', false);
  assertEquals(response.status, 401);
  await response.body?.cancel();
});

Deno.test('whatsapp api › the list gives each exchange its verdict', async () => {
  const response = await get('/v1/dashboard/whatsapp');
  assertEquals(response.status, 200);
  const body = await response.json() as {
    exchanges: Array<{ id: string; verdict: string; inText: string; reasons: string[] }>;
  };
  assertEquals(body.exchanges.map((one) => one.verdict), ['good', 'check']);
  assertEquals(body.exchanges[0]?.reasons, []);
  assert((body.exchanges[1]?.reasons.length ?? 0) > 0);
  assertEquals(body.exchanges[0]?.inText, 'Ramesh 5000 due 15th');
});

Deno.test('whatsapp api › one exchange has its reply and scorecard; unknown id → 404', async () => {
  const response = await get(`/v1/dashboard/whatsapp/${LOST.id}`);
  const body = await response.json() as {
    exchange: { replyText: string };
    scorecard: { verdict: string; groups: Array<{ name: string }> };
  };
  assertEquals(body.scorecard.verdict, 'check');
  assertEquals(body.scorecard.groups.length, 4);
  const missing = await get('/v1/dashboard/whatsapp/e0000000-0000-4000-8000-0000000000ff');
  assertEquals(missing.status, 404);
  await missing.body?.cancel();
});

const TRACE_ID = '9fe11f9b-ec4f-4205-a9c7-cddccff15ebf';

function step(name: string, provider: string | null): TraceStep {
  return {
    source: 'whatsapp-webhook',
    step: name,
    status: 'ok',
    errorCode: null,
    provider,
    durationMs: 10,
    tokensIn: null,
    tokensOut: null,
    detail: {},
    createdAt: FAKE_NOW.toISOString(),
    traceId: TRACE_ID,
  };
}

Deno.test('whatsapp api › one exchange has its steps; only the AI step links to Langfuse', async () => {
  const traced = fakeExchange({ traceId: TRACE_ID });
  const setup = dashboardSetup({
    exchanges: [traced],
    ops: { traces: { [TRACE_ID]: [step('brain_llm', 'sarvam'), step('llm_usage', 'sarvam')] } },
  });
  const dashboard = {
    ...setup.dashboard,
    langfuseTraceUrl: (id: string) => `https://lf.test/${id}`,
  };
  const response = await get(`/v1/dashboard/whatsapp/${traced.id}`, true, deps(dashboard));
  const body = await response.json() as { trace: Array<{ step: string; langfuseUrl?: string }> };
  assertEquals(body.trace.map((one) => one.step), ['brain_llm', 'llm_usage']);
  assertEquals(body.trace[0]?.langfuseUrl, `https://lf.test/${TRACE_ID}`);
  assertEquals(body.trace[1]?.langfuseUrl, undefined);
});

Deno.test('whatsapp api › an exchange with no trace id has no steps', async () => {
  const response = await get(`/v1/dashboard/whatsapp/${LOST.id}`);
  const body = await response.json() as { trace: unknown[] };
  assertEquals(body.trace, []);
});
