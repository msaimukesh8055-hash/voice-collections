// supabase/functions/calls-api/whatsapp-routes.test.ts
// GET /v1/dashboard/whatsapp[/:id] through the real router (ADR-0022): behind the dashboard link,
// each exchange with its verdict, one exchange with its scorecard, 404 for an unknown id.
import { assertEquals } from '@std/assert';
import { DASHBOARD_TOKEN_HEADER, signDashboardToken } from '../_shared/auth/dashboard-link.ts';
import { fakeExchange } from '../_shared/db/fake-exchange-reads.ts';
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

function deps(): CallsApiDeps {
  return {
    repo: createFakeRepository().repo,
    clock: () => FAKE_NOW,
    log: () => {},
    allowedOrigins: [ORIGIN],
    sarvam: { apiKey: 'k', orgId: 'o', workspaceId: 'w', appId: 'a', munshiAppId: null },
    fetchImpl: () => Promise.reject(new Error('no network in tests')),
    kickFollowup: () => 0,
    dashboard: dashboardSetup({ exchanges: [fakeExchange(), LOST] }).dashboard,
    munshi: munshiSetup().munshi,
  };
}

async function get(path: string, signed = true): Promise<Response> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (signed) headers[DASHBOARD_TOKEN_HEADER] = await signDashboardToken(LINK_SECRET, FAKE_NOW);
  return handleCallsApi(new Request(`${BASE}${path}`, { headers }), deps());
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
    exchanges: Array<{ id: string; verdict: string; inText: string }>;
  };
  assertEquals(body.exchanges.map((one) => one.verdict), ['good', 'check']);
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
