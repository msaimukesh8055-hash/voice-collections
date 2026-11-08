// supabase/functions/calls-api/dashboard-routes.test.ts
// The dashboard's API (M6 Decision 9) through the real router: no valid link → 401 and no data
// (security, 100%); the overview, shopkeepers, calls and the one setting it can change.
import { munshiSetup } from './__fixtures__/munshi.ts';
import { assert, assertEquals } from '@std/assert';
import { DASHBOARD_TOKEN_HEADER, signDashboardToken } from '../_shared/auth/dashboard-link.ts';
import type { DashboardCallDetail } from '../_shared/db/dashboard-repository.ts';
import { FAKE_OWNER, RAMESH } from '../_shared/db/fake-book-repository.ts';
import { createFakeRepository, FAKE_NOW } from '../_shared/db/fake-repository.ts';
import { handleCallsApi } from './handler.ts';
import { dashboardSetup, LINK_SECRET } from './__fixtures__/dashboard.ts';
import type { CallsApiDeps } from './types.ts';

const ORIGIN = 'http://localhost:5173';
const BASE = 'https://ref.supabase.co/functions/v1/calls-api';

const CALL: DashboardCallDetail = {
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
  toolEvents: [],
  followup: { path: 'rule', decision: 'check_promise', reasoning: 'Promise logged' },
};

function deps(
  options: Parameters<typeof dashboardSetup>[0] = {},
): { all: CallsApiDeps; setup: ReturnType<typeof dashboardSetup> } {
  const setup = dashboardSetup({ reads: { calls: [CALL] }, ...options });
  const { repo } = createFakeRepository();
  const all: CallsApiDeps = {
    repo,
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

async function call(
  path: string,
  all: CallsApiDeps,
  options: { token?: string | null; method?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = options.token === undefined
    ? await signDashboardToken(LINK_SECRET, FAKE_NOW)
    : options.token;
  const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' };
  if (token !== null) headers[DASHBOARD_TOKEN_HEADER] = token;
  const response = await handleCallsApi(
    new Request(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    all,
  );
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

const PATHS = [
  '/v1/dashboard/overview',
  '/v1/dashboard/shopkeepers',
  `/v1/dashboard/shopkeepers/${RAMESH.id}`,
  '/v1/dashboard/calls',
  `/v1/dashboard/calls/${CALL.id}`,
];

Deno.test('dashboard api › no token, a wrong one or an expired one → 401 and no data', async () => {
  const { all } = deps();
  const expired = await signDashboardToken(
    LINK_SECRET,
    new Date(FAKE_NOW.getTime() - 2 * 86_400_000),
  );
  const forged = await signDashboardToken('another-secret-that-is-32-characters-long', FAKE_NOW);
  for (const path of PATHS) {
    for (const token of [null, 'nonsense', expired, forged]) {
      const result = await call(path, all, { token });
      assertEquals(result.status, 401, `${path} ${token}`);
      assert(!JSON.stringify(result.body).includes('Ramesh'));
    }
  }
  const settings = await call('/v1/dashboard/settings', all, {
    token: null,
    method: 'POST',
    body: { englishUnderTelugu: false },
  });
  assertEquals(settings.status, 401);
});

Deno.test('dashboard api › the browser may send the token header (CORS)', async () => {
  const { all } = deps();
  const response = await handleCallsApi(
    new Request(`${BASE}/v1/dashboard/overview`, {
      method: 'OPTIONS',
      headers: { origin: ORIGIN },
    }),
    all,
  );
  assert(response.headers.get('access-control-allow-headers')?.includes(DASHBOARD_TOKEN_HEADER));
});

Deno.test('dashboard api › overview: insights with scored top 5, recent calls with cost', async () => {
  const { all } = deps();
  const { status, body } = await call('/v1/dashboard/overview', all);
  assertEquals(status, 200);
  const insights = body.insights as { today: string; top: Array<{ band: string }> };
  assertEquals(insights.today, '2026-11-02');
  assert(insights.top.length > 0 && typeof insights.top[0]?.band === 'string');
  const calls = body.calls as Array<{ shopkeeperName: string; cost: { inr: number } }>;
  assertEquals([calls[0]?.shopkeeperName, calls[0]?.cost.inr], ['Ramesh', 12.39]);
  assertEquals(body.settings, { englishUnderTelugu: false });
});

Deno.test('dashboard api › shopkeepers: biggest balance first', async () => {
  const { all } = deps();
  const { body } = await call('/v1/dashboard/shopkeepers', all);
  const rows = body.shopkeepers as Array<{ name: string; outstanding: number }>;
  assertEquals(rows[0], { ...rows[0], name: 'Ramesh', outstanding: 8500 });
  assert(rows.every((row, i) => i === 0 || rows[i - 1]!.outstanding >= row.outstanding));
});

Deno.test('dashboard api › one shopkeeper: dues, score parts, entries, promises, notes, calls', async () => {
  const { all } = deps({
    reads: {
      calls: [CALL],
      promises: {
        [RAMESH.id]: [{
          amount: 3000,
          promiseDate: '2026-10-30',
          status: 'broken',
          createdAt: 'c',
        }],
      },
      notes: { [RAMESH.id]: [{ note: 'Busy shop', createdAt: 'd' }] },
    },
  });
  const { status, body } = await call(`/v1/dashboard/shopkeepers/${RAMESH.id}`, all);
  assertEquals(status, 200);
  assertEquals((body.dues as { outstanding: number }).outstanding, 8500);
  assert('parts' in (body.score as object));
  assertEquals((body.notes as unknown[]).length, 1);
  assertEquals((body.calls as unknown[]).length, 1);
  assert((body.entries as unknown[]).length > 0);
});

Deno.test('dashboard api › unknown shopkeeper or call → 404', async () => {
  const { all } = deps();
  assertEquals((await call('/v1/dashboard/shopkeepers/nobody', all)).status, 404);
  assertEquals((await call('/v1/dashboard/calls/nothing', all)).status, 404);
});

Deno.test('dashboard api › calls list and one call with transcript and follow-up', async () => {
  const { all } = deps();
  const list = await call('/v1/dashboard/calls', all);
  assertEquals((list.body.calls as unknown[]).length, 1);
  const { body } = await call(`/v1/dashboard/calls/${CALL.id}`, all);
  const detail = body.call as DashboardCallDetail & { shopkeeperName: string };
  assertEquals(detail.transcript, CALL.transcript);
  assertEquals(detail.followup?.decision, 'check_promise');
  assertEquals(detail.shopkeeperName, 'Ramesh');
});

Deno.test('dashboard api › with no owner row: overview and lists say not found or empty', async () => {
  const { all } = deps({ book: { owner: null } });
  assertEquals((await call('/v1/dashboard/overview', all)).status, 404);
  assertEquals((await call('/v1/dashboard/shopkeepers', all)).status, 404);
  assertEquals((await call(`/v1/dashboard/shopkeepers/${RAMESH.id}`, all)).status, 404);
  assertEquals(
    ((await call('/v1/dashboard/calls', all)).body.calls as Array<{ shopkeeperName: string }>)[0]
      ?.shopkeeperName,
    '?',
  );
  assertEquals((await call(`/v1/dashboard/calls/${CALL.id}`, all)).status, 200);
  const settings = await call('/v1/dashboard/settings', all, {
    method: 'POST',
    body: { englishUnderTelugu: true },
  });
  assertEquals(settings.status, 404);
});

Deno.test('dashboard api › the English-under-Telugu switch: saved; bad body → 400', async () => {
  const { all, setup } = deps();
  const ok = await call('/v1/dashboard/settings', all, {
    method: 'POST',
    body: { englishUnderTelugu: true },
  });
  assertEquals(ok.status, 200);
  assertEquals(setup.reads.englishUnderTelugu, { [FAKE_OWNER.id]: true });
  const bad = await call('/v1/dashboard/settings', all, { method: 'POST', body: { on: 'yes' } });
  assertEquals(bad.status, 400);
});

Deno.test('dashboard api › a Telugu transcript gets its English once, then it is kept', async () => {
  const telugu: DashboardCallDetail = {
    ...CALL,
    transcript: [
      { role: 'assistant', content: 'Namaste' },
      { role: 'user', content: 'Ramesh సోమవారం ఇస్తాను' },
    ],
  };
  const asked: string[] = [];
  const setup = dashboardSetup({
    reads: { calls: [telugu] },
    translate: (request) => {
      asked.push(request.text);
      return Promise.resolve(request.keep.includes('Ramesh') ? 'Ramesh will pay Monday' : null);
    },
  });
  const { all } = deps();
  const withTranslate: CallsApiDeps = { ...all, dashboard: setup.dashboard };
  const first = await call(`/v1/dashboard/calls/${CALL.id}`, withTranslate);
  assertEquals((first.body.call as DashboardCallDetail).transcriptEnglish, [
    null,
    'Ramesh will pay Monday',
  ]);
  assertEquals(setup.reads.savedEnglish[CALL.id], [null, 'Ramesh will pay Monday']);
  await call(`/v1/dashboard/calls/${CALL.id}`, withTranslate);
  assertEquals(asked.length, 1);
});

Deno.test('dashboard api › English transcript not saved → still shown, and logged', async () => {
  const telugu: DashboardCallDetail = {
    ...CALL,
    transcript: [{ role: 'user', content: 'సోమవారం' }],
  };
  const setup = dashboardSetup({
    reads: { calls: [telugu] },
    translate: () => Promise.resolve('Monday'),
  });
  const logs: string[] = [];
  const { all } = deps();
  const broken: CallsApiDeps = {
    ...all,
    log: (_level, event) => logs.push(event),
    dashboard: {
      ...setup.dashboard,
      reads: {
        ...setup.dashboard.reads,
        saveEnglishTranscript: () => Promise.reject(new Error('db down')),
      },
    },
  };
  const result = await call(`/v1/dashboard/calls/${CALL.id}`, broken);
  assertEquals((result.body.call as DashboardCallDetail).transcriptEnglish, ['Monday']);
  assertEquals(logs.includes('transcript_english_not_saved'), true);
});
