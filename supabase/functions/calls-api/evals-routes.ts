// supabase/functions/calls-api/evals-routes.ts
// The Evals page's read (M9 Build C4), behind the same signed link as the rest of the dashboard:
//   GET /v1/dashboard/evals → for each thing tested (Asha, the WhatsApp brain): its latest run
//   with every case, and its recent runs as a trend.
// The page shows what the runners stored; nothing is re-judged here.
import type { EvalCaseResult, EvalRun } from '../_shared/db/eval-reads.ts';
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
      const cases = await reads.listResults(latest.id);
      return { target, latest, cases, history: runs.slice(0, TREND_LENGTH) };
    }),
  );
  const listed = targets.filter((target) => target !== null).sort((a, b) =>
    a.target.localeCompare(b.target)
  );
  return jsonResponse({ targets: listed, generatedAt: deps.clock().toISOString() }, 200, cors);
}

export const EVALS_ROUTES: Readonly<Record<'summary', RouteHandler>> = {
  summary: openInDemo(getEvals),
};
