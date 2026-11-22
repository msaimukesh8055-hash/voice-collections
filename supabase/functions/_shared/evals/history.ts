// supabase/functions/_shared/evals/history.ts
// "How it got fixed" (Saim, 2026-11-22): for one thing tested (Asha, Munshi, the brain), each case
// across its recent runs, oldest first, plus what changed before each run and which cases a later
// run fixed. Pure code. Whether the prompt changed comes from the prompt hash, never from a note.
import { RUN_NOTES, type RunChangeKind } from './run-notes.ts';

export interface HistoryRunInput {
  readonly id: string;
  readonly createdAt: string;
  readonly promptHash: string;
  readonly passed: boolean;
  readonly casesPassed: number;
  readonly cases: number;
  readonly appVersion: number | null;
}

export interface CaseOutcome {
  readonly runId: string;
  readonly scenarioId: string;
  readonly name: string;
  readonly pass: boolean;
}

export interface HistoryRun extends HistoryRunInput {
  /** The prompt hash differs from the run before (false for the first run shown). */
  readonly promptChanged: boolean;
  readonly change: RunChangeKind;
  readonly note: string | null;
}

export interface HistoryCase {
  readonly scenarioId: string;
  readonly name: string;
  /** Run id → passed; a run that did not include the case is missing. */
  readonly results: Readonly<Record<string, boolean>>;
  /** Failed in an earlier run shown and passes in the latest: the run that fixed it for good. */
  readonly fixedIn: string | null;
  /** The last run it failed in before that fix, for the before / after view. */
  readonly lastFailedIn: string | null;
}

export interface CaseHistory {
  readonly runs: readonly HistoryRun[];
  readonly cases: readonly HistoryCase[];
}

function changeOf(run: HistoryRunInput, before: HistoryRunInput | undefined): HistoryRun {
  const promptChanged = before !== undefined && before.promptHash !== run.promptHash;
  const written = RUN_NOTES[run.id];
  const guessed: RunChangeKind = before === undefined
    ? 'first'
    : promptChanged
    ? 'prompt'
    : 'rerun';
  return { ...run, promptChanged, change: written?.kind ?? guessed, note: written?.note ?? null };
}

function fixOf(
  runs: readonly HistoryRun[],
  results: Readonly<Record<string, boolean>>,
): Pick<HistoryCase, 'fixedIn' | 'lastFailedIn'> {
  const ran = runs.filter((run) => results[run.id] !== undefined);
  const latest = ran.at(-1);
  if (!latest || results[latest.id] !== true) return { fixedIn: null, lastFailedIn: null };
  let lastFailed = -1;
  ran.forEach((run, index) => {
    if (results[run.id] === false) lastFailed = index;
  });
  const failed = ran[lastFailed];
  const fixed = ran[lastFailed + 1];
  if (!failed || !fixed) return { fixedIn: null, lastFailedIn: null };
  return { fixedIn: fixed.id, lastFailedIn: failed.id };
}

/** `runs` newest first, as stored; the history comes back oldest first. */
export function caseHistory(
  runs: readonly HistoryRunInput[],
  outcomes: readonly CaseOutcome[],
): CaseHistory {
  const oldestFirst = [...runs].reverse();
  const shown = oldestFirst.map((run, index) => changeOf(run, oldestFirst[index - 1]));
  const byCase = new Map<string, { name: string; results: Record<string, boolean> }>();
  for (const outcome of outcomes) {
    const entry = byCase.get(outcome.scenarioId) ?? { name: outcome.name, results: {} };
    entry.results[outcome.runId] = outcome.pass;
    if (!entry.name) entry.name = outcome.name;
    byCase.set(outcome.scenarioId, entry);
  }
  const cases = [...byCase.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([scenarioId, entry]) => ({
      scenarioId,
      name: entry.name,
      results: entry.results,
      ...fixOf(shown, entry.results),
    }));
  return { runs: shown, cases };
}
