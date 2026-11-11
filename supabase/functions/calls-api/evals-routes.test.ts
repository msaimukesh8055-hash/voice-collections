// supabase/functions/calls-api/evals-routes.test.ts
// The Evals page's API (M9 Build C4) through the real router, and its database reads.
import { assertEquals } from '@std/assert';
import { DASHBOARD_TOKEN_HEADER, signDashboardToken } from '../_shared/auth/dashboard-link.ts';
import { createEvalReads, type EvalCaseResult, type EvalRun } from '../_shared/db/eval-reads.ts';
import { createFakeRepository, FAKE_NOW } from '../_shared/db/fake-repository.ts';
import { handleCallsApi } from './handler.ts';
import { dashboardSetup, type FakeEvals, LINK_SECRET } from './__fixtures__/dashboard.ts';
import { munshiSetup } from './__fixtures__/munshi.ts';
import { TREND_LENGTH } from './evals-routes.ts';
import type { CallsApiDeps } from './types.ts';

const BASE = 'https://ref.supabase.co/functions/v1/calls-api';
const RUN_ID = '88888888-8888-4888-8888-888888888888';

function run(target: string, minute: number, id = crypto.randomUUID()): EvalRun {
  return {
    id,
    target,
    promptHash: 'abc',
    metrics: { passed: minute % 2 === 0, cases: 9 },
    createdAt: `2026-11-11T16:${String(minute).padStart(2, '0')}:00+00:00`,
  };
}

const CASE: EvalCaseResult = {
  scenarioId: 'asha-07',
  scores: { name: 'Wrong person answers', verdicts: [], checks: [] },
  transcript: 'assistant: Namaste',
  pass: false,
};

function deps(evals: FakeEvals, publicDemo = false): CallsApiDeps {
  const { dashboard } = dashboardSetup({ evals });
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
  all: CallsApiDeps,
  token?: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const value = token === undefined ? await signDashboardToken(LINK_SECRET, FAKE_NOW) : token;
  const headers: Record<string, string> = value === null ? {} : { [DASHBOARD_TOKEN_HEADER]: value };
  const request = new Request(`${BASE}/v1/dashboard/evals`, { headers });
  const response = await handleCallsApi(request, all);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

Deno.test('evals route › without a valid link: 401 and no data; the public demo opens it', async () => {
  const evals = { runs: [run('asha', 30, RUN_ID)], results: { [RUN_ID]: [CASE] } };
  for (const token of [null, 'forged.token']) {
    const { status, body } = await get(deps(evals), token);
    assertEquals([status, Object.keys(body)], [401, ['error']]);
  }
  assertEquals((await get(deps(evals, true), null)).status, 200);
});

Deno.test('evals route › each target: its latest run with cases, and its runs newest first', async () => {
  const latest = run('asha', 30, RUN_ID);
  const older = run('asha', 10);
  const brain = run('brain', 20);
  const evals = { runs: [latest, brain, older], results: { [RUN_ID]: [CASE] } };
  const { status, body } = await get(deps(evals));
  assertEquals(status, 200);
  assertEquals(body.targets, [
    { target: 'asha', latest, cases: [CASE], history: [latest, older] },
    { target: 'brain', latest: brain, cases: [], history: [brain] },
  ]);
  assertEquals(body.generatedAt, FAKE_NOW.toISOString());
});

Deno.test('evals route › the trend is capped; nothing stored yet is an empty list, not an error', async () => {
  const many = Array.from(
    { length: TREND_LENGTH + 5 },
    (_unused, index) => run('asha', 59 - index),
  );
  const { body } = await get(deps({ runs: many, results: {} }));
  const targets = body.targets as { history: unknown[] }[];
  assertEquals(targets[0]?.history.length, TREND_LENGTH);
  assertEquals((await get(deps({ runs: [], results: {} }))).body.targets, []);
});

Deno.test("eval reads › runs newest first with a cap; one run's cases by scenario id", async () => {
  const paths: string[] = [];
  const reads = createEvalReads((_operation, path) => {
    paths.push(path);
    const rows = path.startsWith('eval_runs')
      ? [{
        id: RUN_ID,
        target: 'asha',
        prompt_hash: 'abc',
        metrics: { passed: false },
        created_at: '2026-11-11T16:30:00+00:00',
      }]
      : [{ scenario_id: 'asha-07', scores: null, transcript: 't', pass: false }];
    return Promise.resolve({ rows, contentRange: null });
  });
  const runs = await reads.listRuns(40);
  assertEquals(runs[0], {
    id: RUN_ID,
    target: 'asha',
    promptHash: 'abc',
    metrics: { passed: false },
    createdAt: '2026-11-11T16:30:00+00:00',
  });
  const results = await reads.listResults(RUN_ID);
  // Scores that are not an object read as empty, never as a crash.
  assertEquals(results, [{ scenarioId: 'asha-07', scores: {}, transcript: 't', pass: false }]);
  assertEquals(paths, [
    'eval_runs?select=id,target,prompt_hash,metrics,created_at&order=created_at.desc&limit=40',
    `eval_results?select=scenario_id,scores,transcript,pass&run_id=eq.${RUN_ID}` +
    '&order=scenario_id&limit=100',
  ]);
});
