// supabase/functions/calls-api/evals-routes.ts
// The Evals page's read (M9 Build C4), behind the same signed link as the rest of the dashboard:
//   GET /v1/dashboard/evals → for each thing tested (Asha, the WhatsApp brain): its latest run
//   with every case, and its recent runs as a trend.
//   2026-11-22 ("How it got fixed"): each target also gets its case history (every case across
//   the recent runs, what changed before each run, which cases a run fixed), and
//   GET /v1/dashboard/evals/runs/:runId/cases/:caseId gives one case of an older run with its
//   conversation, for the before / after view.
//   2026-11-23 (golden outcomes): each target also carries what every case expects (golden-cases.ts,
//   generated from evals/), so the page can show expected vs this run row by row.
//   2026-11-23 (new cases run on their own): a run of some cases only (metrics.only) never stands
//   in for the full release gate. "latest" is the newest full run; a case it does not have comes
//   from the newest partial run that has it, marked with that run (ranAlone).
//   2026-11-23 (model choice): bake-off runs (target "brain-model", npm run evals:bakeoff) are not
//   a release gate, so they are left out of targets and returned as modelChoice, the newest run
//   per model.
// The page shows what the runners stored; nothing is re-judged here.
import type { EvalCaseResult, EvalRun } from '../_shared/db/eval-reads.ts';
import type { GoldenCase, GoldenTarget } from '../_shared/evals/golden.ts';
import { GOLDEN } from '../_shared/evals/golden-cases.ts';
import { type CaseHistory, caseHistory, type HistoryRunInput } from '../_shared/evals/history.ts';
import { jsonResponse } from '../_shared/http.ts';
import { openInDemo } from './dashboard-routes.ts';
import type { RouteContext, RouteHandler } from './types.ts';

/** Enough runs to give each target its trend. */
const RUNS_READ = 40;
export const TREND_LENGTH = 10;
export const MODEL_TARGET = 'brain-model';

/** A case of the latest full run, or one a newer partial run added (ranAlone says which). */
export interface ShownCase extends EvalCaseResult {
  readonly ranAlone: { readonly runId: string; readonly createdAt: string } | null;
}

export interface EvalTarget {
  readonly target: string;
  readonly latest: EvalRun;
  readonly cases: readonly ShownCase[];
  /** Newest first, the latest run included. */
  readonly history: readonly EvalRun[];
  readonly caseHistory: CaseHistory;
  /** What each case expects; empty for a target with no golden set. */
  readonly golden: readonly GoldenCase[];
}

function goldenOf(target: string): readonly GoldenCase[] {
  return Object.hasOwn(GOLDEN, target) ? GOLDEN[target as GoldenTarget] : [];
}

function historyRun(run: EvalRun): HistoryRunInput {
  const m = run.metrics;
  const number = (value: unknown): number | null => typeof value === 'number' ? value : null;
  return {
    id: run.id,
    createdAt: run.createdAt,
    promptHash: run.promptHash,
    passed: m['passed'] === true,
    casesPassed: number(m['casesPassed']) ?? 0,
    cases: number(m['cases']) ?? 0,
    appVersion: number(m['appVersion']),
  };
}

/** Run with --only: some cases, not the whole release gate. */
export function isPartial(run: EvalRun): boolean {
  const only = run.metrics['only'];
  return typeof only === 'string' && only.length > 0;
}

/** Cases of the newer partial runs that the full run does not have, newest run first. */
async function addedCases(
  reads: RouteContext['deps']['dashboard']['evals'],
  partials: readonly EvalRun[],
  have: ReadonlySet<string>,
): Promise<readonly ShownCase[]> {
  const seen = new Set(have);
  const added: ShownCase[] = [];
  for (const run of partials) {
    for (const result of await reads.listResults(run.id)) {
      if (seen.has(result.scenarioId)) continue;
      seen.add(result.scenarioId);
      added.push({ ...result, ranAlone: { runId: run.id, createdAt: run.createdAt } });
    }
  }
  return added;
}

async function shownCases(
  reads: RouteContext['deps']['dashboard']['evals'],
  runs: readonly EvalRun[],
  latest: EvalRun,
): Promise<readonly ShownCase[]> {
  const full = (await reads.listResults(latest.id)).map((one) => ({ ...one, ranAlone: null }));
  const newer = runs.slice(0, runs.indexOf(latest)).filter(isPartial);
  const added = await addedCases(reads, newer, new Set(full.map((one) => one.scenarioId)));
  return [...full, ...added];
}

function byTarget(runs: readonly EvalRun[]): ReadonlyMap<string, readonly EvalRun[]> {
  return Map.groupBy(runs, (run) => run.target);
}

/** The newest bake-off run per model, oldest of those first (the order the bake-off runs them). */
export function modelChoice(runs: readonly EvalRun[]): readonly EvalRun[] {
  const newest = new Map<string, EvalRun>();
  for (const run of runs) {
    const model = run.metrics['model'];
    if (typeof model !== 'string' || newest.has(model)) continue;
    newest.set(model, run);
  }
  return [...newest.values()].reverse();
}

async function getEvals(_req: Request, { deps, cors }: RouteContext): Promise<Response> {
  const reads = deps.dashboard.evals;
  const all = byTarget(await reads.listRuns(RUNS_READ));
  const groups = [...all.entries()].filter(([target]) => target !== MODEL_TARGET);
  const targets = await Promise.all(
    groups.map(async ([target, runs]): Promise<EvalTarget | null> => {
      const latest = runs.find((run) => !isPartial(run)) ?? runs[0];
      if (!latest) return null;
      const history = runs.slice(0, TREND_LENGTH);
      const [cases, outcomes] = await Promise.all([
        shownCases(reads, runs, latest),
        reads.listOutcomes(history.map((run) => run.id)),
      ]);
      return {
        target,
        latest,
        cases,
        history,
        caseHistory: caseHistory(history.map(historyRun), outcomes, target),
        golden: goldenOf(target),
      };
    }),
  );
  const listed = targets.filter((target) => target !== null).sort((a, b) =>
    a.target.localeCompare(b.target)
  );
  const models = modelChoice(all.get(MODEL_TARGET) ?? []);
  return jsonResponse(
    { targets: listed, modelChoice: models, generatedAt: deps.clock().toISOString() },
    200,
    cors,
  );
}

async function getCase(_req: Request, { deps, cors, params }: RouteContext): Promise<Response> {
  const [runId = '', caseId = ''] = params;
  const result = await deps.dashboard.evals.getResult(runId, caseId);
  if (!result) return jsonResponse({ error: 'not_found' }, 404, cors);
  return jsonResponse({ result }, 200, cors);
}

export const EVALS_ROUTES: Readonly<Record<'summary' | 'case', RouteHandler>> = {
  summary: openInDemo(getEvals),
  case: openInDemo(getCase),
};
