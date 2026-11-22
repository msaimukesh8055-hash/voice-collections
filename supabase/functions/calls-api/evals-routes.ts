// supabase/functions/calls-api/evals-routes.ts
// The Evals page's read (M9 Build C4), behind the same signed link as the rest of the dashboard:
//   GET /v1/dashboard/evals → for each thing tested (Asha, the WhatsApp brain): its latest run
//   with every case, and its recent runs as a trend.
//   2026-11-22 ("How it got fixed"): each target also gets its case history (every case across
//   the recent runs, what changed before each run, which cases a run fixed), and
//   GET /v1/dashboard/evals/runs/:runId/cases/:caseId gives one case of an older run with its
//   conversation, for the before / after view.
// The page shows what the runners stored; nothing is re-judged here.
import type { EvalCaseResult, EvalRun } from '../_shared/db/eval-reads.ts';
import { type CaseHistory, caseHistory, type HistoryRunInput } from '../_shared/evals/history.ts';
import { jsonResponse } from '../_shared/http.ts';
import { openInDemo } from './dashboard-routes.ts';
import type { RouteContext, RouteHandler } from './types.ts';

/** Enough runs to give each target its trend. */
const RUNS_READ = 40;
export const TREND_LENGTH = 10;

export interface EvalTarget {
  readonly target: string;
  readonly latest: EvalRun;
  readonly cases: readonly EvalCaseResult[];
  /** Newest first, the latest run included. */
  readonly history: readonly EvalRun[];
  readonly caseHistory: CaseHistory;
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

function byTarget(runs: readonly EvalRun[]): ReadonlyMap<string, readonly EvalRun[]> {
  return Map.groupBy(runs, (run) => run.target);
}

async function getEvals(_req: Request, { deps, cors }: RouteContext): Promise<Response> {
  const reads = deps.dashboard.evals;
  const groups = [...byTarget(await reads.listRuns(RUNS_READ)).entries()];
  const targets = await Promise.all(
    groups.map(async ([target, runs]): Promise<EvalTarget | null> => {
      const latest = runs[0];
      if (!latest) return null;
      const history = runs.slice(0, TREND_LENGTH);
      const [cases, outcomes] = await Promise.all([
        reads.listResults(latest.id),
        reads.listOutcomes(history.map((run) => run.id)),
      ]);
      return {
        target,
        latest,
        cases,
        history,
        caseHistory: caseHistory(history.map(historyRun), outcomes, target),
      };
    }),
  );
  const listed = targets.filter((target) => target !== null).sort((a, b) =>
    a.target.localeCompare(b.target)
  );
  return jsonResponse({ targets: listed, generatedAt: deps.clock().toISOString() }, 200, cors);
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
