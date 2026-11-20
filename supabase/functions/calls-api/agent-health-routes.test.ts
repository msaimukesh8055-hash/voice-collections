// supabase/functions/calls-api/agent-health-routes.test.ts
// GET /v1/dashboard/health through the real router: behind the dashboard link; a finished live
// call that was never scored is scored on load and kept; both agents come back with their health.
import { assert, assertEquals } from '@std/assert';
import { DASHBOARD_TOKEN_HEADER, signDashboardToken } from '../_shared/auth/dashboard-link.ts';
import type { DashboardCallDetail } from '../_shared/db/dashboard-repository.ts';
import { RAMESH } from '../_shared/db/fake-book-repository.ts';
import { fakeOwnerCallDetail } from '../_shared/db/fake-owner-call-reads.ts';
import { createFakeRepository, FAKE_NOW } from '../_shared/db/fake-repository.ts';
import { dashboardSetup, LINK_SECRET } from './__fixtures__/dashboard.ts';
import { munshiSetup } from './__fixtures__/munshi.ts';
import { handleCallsApi } from './handler.ts';
import type { CallsApiDeps } from './types.ts';

const ORIGIN = 'http://localhost:5173';
const BASE = 'https://ref.supabase.co/functions/v1/calls-api';

const ASHA_CALL: DashboardCallDetail = {
  id: 'c0000000-0000-4000-8000-000000000001',
  shopkeeperId: RAMESH.id,
  mode: 'live',
  status: 'completed',
  language: 'te',
  toneLevel: 2,
  queuedAt: '2026-11-02T06:00:00Z',
  endedAt: '2026-11-02T06:03:00Z',
  durationSeconds: 170,
  summary: 'Promised Monday',
  transcript: [{ role: 'assistant', content: 'Namaste' }],
  transcriptEnglish: null,
  toneJudgement: null,
  toolEvents: [],
  followup: null,
};

const SIMULATED: DashboardCallDetail = {
  ...ASHA_CALL,
  id: 'c0000000-0000-4000-8000-000000000002',
  mode: 'simulated',
};

function deps(): { all: CallsApiDeps; setup: ReturnType<typeof dashboardSetup> } {
  const setup = dashboardSetup({
    reads: { calls: [ASHA_CALL, SIMULATED] },
    ownerCalls: [
      fakeOwnerCallDetail({ transcript: [{ role: 'user', content: 'Total pending?' }] }),
    ],
    callScores: { publishes: [{ agent: 'asha', version: 5, publishedAt: '2026-11-01T00:00:00Z' }] },
  });
  const all: CallsApiDeps = {
    repo: createFakeRepository().repo,
    clock: () => FAKE_NOW,
    log: () => {},
    allowedOrigins: [ORIGIN],
    sarvam: { apiKey: 'k', orgId: 'o', workspaceId: 'w', appId: 'a', munshiAppId: null },
    fetchImpl: () => Promise.reject(new Error('no network in tests')),
    kickFollowup: () => 0,
    dashboard: setup.dashboard,
    munshi: munshiSetup().munshi,
  };
  return { all, setup };
}

async function get(path: string, all: CallsApiDeps, signed = true): Promise<Response> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (signed) headers[DASHBOARD_TOKEN_HEADER] = await signDashboardToken(LINK_SECRET, FAKE_NOW);
  return handleCallsApi(new Request(`${BASE}${path}`, { headers }), all);
}

interface HealthBody {
  readonly waiting: number;
  readonly agents: ReadonlyArray<{
    readonly agent: string;
    readonly calls: number;
    readonly versions: ReadonlyArray<{ readonly version: number | null }>;
  }>;
}

Deno.test('agent health api › no valid dashboard link → 401', async () => {
  const response = await get('/v1/dashboard/health', deps().all, false);
  assertEquals(response.status, 401);
  await response.body?.cancel();
});

Deno.test('agent health api › unscored live calls are scored and kept; simulated ones are not', async () => {
  const { all, setup } = deps();
  const response = await get('/v1/dashboard/health', all);
  assertEquals(response.status, 200);
  const body = await response.json() as HealthBody;
  assertEquals(setup.scores.scores.map((one) => one.agent).sort(), ['asha', 'munshi']);
  assertEquals(body.waiting, 0);
  assertEquals(body.agents.map((one) => [one.agent, one.calls]), [['asha', 1], ['munshi', 1]]);
  assertEquals(body.agents[0]?.versions[0]?.version, 5);
  await (await get('/v1/dashboard/health', all)).body?.cancel();
  assertEquals(setup.scores.scores.length, 2);
});

Deno.test('agent health api › opening a call page keeps its score too', async () => {
  const { all, setup } = deps();
  const response = await get(`/v1/dashboard/calls/${ASHA_CALL.id}`, all);
  assertEquals(response.status, 200);
  await response.body?.cancel();
  assert(setup.scores.scores.some((one) => one.callId === ASHA_CALL.id));
});
