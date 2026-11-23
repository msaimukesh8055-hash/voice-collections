// evals/sarvam/munshi-runner.ts
// One Munshi run on Sarvam Tests from start to finish (M9 Build F): create one flagged eval owner
// with a fresh fake book and a live owner-call token per case, build the suite in Sarvam with each
// case pointed at its own token, run it against the given Munshi version, wait, then combine
// Sarvam's verdicts with our own database checks. The owner calls are always ended at the end,
// also when the run fails, so no eval token stays usable.
import { OWNER_CALL_TOKEN_VARIABLE } from '../../supabase/functions/_shared/sarvam.ts';
import type { AgentVersion, NewSuite, SarvamTests, SuiteVariable } from './client.ts';
import { casePassed } from './gate.ts';
import type { MunshiCase } from './munshi-cases.ts';
import { checkMunshiCall, checkNoPhoneNumbers } from './munshi-checks.ts';
import type { MunshiEvalDb } from './munshi-eval-db.ts';
import {
  buildMunshiEvalRows,
  type MunshiDataOptions,
  type MunshiEvalRows,
  outcomeFor,
} from './munshi-eval-data.ts';
import { EvalRunError, type RunOutcome, waitForRun } from './runner.ts';
import type { CaseResult } from './types.ts';

export interface MunshiRunPlan {
  readonly agent: AgentVersion;
  readonly suiteName: string;
  readonly cases: readonly MunshiCase[];
  readonly guardrails: readonly string[];
  /** Agent variables every case shares (owner names, business name, today). */
  readonly sharedVariables: readonly SuiteVariable[];
  readonly data: MunshiDataOptions;
}

export interface MunshiRunnerDeps {
  readonly sarvam: SarvamTests;
  readonly db: MunshiEvalDb;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => Date;
  readonly onProgress?: (line: string) => void;
}

export function munshiSuite(plan: MunshiRunPlan, rows: MunshiEvalRows): NewSuite {
  return {
    name: plan.suiteName,
    description:
      'Created by evals/sarvam/munshi-run.ts. Fake data: each case has its own eval owner and token.',
    variables: [...plan.sharedVariables, { name: OWNER_CALL_TOKEN_VARIABLE, value: '-' }],
    global_guardrails: plan.guardrails,
    test_cases: plan.cases.map((evalCase) => ({
      name: evalCase.id,
      category: evalCase.category,
      user_scenario: evalCase.scenario,
      expected_behaviors: evalCase.behaviours,
      max_turns: evalCase.maxTurns,
      variable_overrides: [
        { name: OWNER_CALL_TOKEN_VARIABLE, value: rows.byCase.get(evalCase.id)?.ownerCallId ?? '' },
      ],
    })),
  };
}

async function resultFor(
  evalCase: MunshiCase,
  ref: { suiteId: string; runId: string; caseId: string | undefined; rows: MunshiEvalRows },
  deps: MunshiRunnerDeps,
): Promise<CaseResult> {
  const caseRows = ref.rows.byCase.get(evalCase.id);
  if (!caseRows || !ref.caseId)
    throw new EvalRunError(`case ${evalCase.id} is missing from the suite`);
  const [executions, evidence] = await Promise.all([
    deps.sarvam.getCaseResults(ref.suiteId, { runId: ref.runId, caseId: ref.caseId }),
    deps.db.readEvidence(caseRows),
  ]);
  const execution = executions[0];
  const verdicts = execution?.verdicts ?? [];
  const outcome = outcomeFor(evalCase.outcome, caseRows.ids);
  const transcript = execution?.transcript ?? [];
  const checks = [
    ...checkMunshiCall(evalCase, { outcome, ids: caseRows.ids }, evidence),
    checkNoPhoneNumbers(transcript),
  ];
  const judged = { verdicts, checks };
  return {
    id: evalCase.id,
    name: evalCase.name,
    category: evalCase.category,
    ...judged,
    transcript,
    // A case Sarvam returned no verdicts for cannot count as a pass.
    passed: verdicts.length > 0 && casePassed(judged),
  };
}

/**
 * Keeps every case's call clock where the case wants it (30 s in, or 7:10 for the wrap-up case)
 * until the run completes: owner tools refuse a call 10 minutes after it was accepted, and Sarvam
 * can queue a run longer than that. One update per distinct start offset.
 */
export async function refreshCallClocks(
  cases: readonly MunshiCase[],
  rows: MunshiEvalRows,
  deps: Pick<MunshiRunnerDeps, 'db' | 'now'>,
): Promise<void> {
  const byAgo = new Map<number, string[]>();
  for (const evalCase of cases) {
    const ownerCallId = rows.byCase.get(evalCase.id)?.ownerCallId;
    if (ownerCallId)
      byAgo.set(evalCase.acceptedAgoMs, [
        ...(byAgo.get(evalCase.acceptedAgoMs) ?? []),
        ownerCallId,
      ]);
  }
  for (const [agoMs, ids] of byAgo) await deps.db.restartOwnerCalls(ids, deps.now(), agoMs);
}

/** How often the call clocks are reset while the run is queued or going. */
const CLOCK_REFRESH_MS = 15_000;

/**
 * Resets the call clocks every 15 s on a timer of its own, not only on each poll: a poll can sit
 * in Sarvam's rate-limit waits for minutes, and case 15 (7:10 in) ran out of time that way
 * (2026-11-20 run 3). Returns the function that stops it.
 */
function keepCallClocks(
  refresh: () => Promise<void>,
  onProgress?: (line: string) => void,
): () => void {
  function tick(): void {
    refresh().catch(function report(error: unknown) {
      onProgress?.(`call clock reset failed: ${String(error)}`);
    });
  }
  const timer = setInterval(tick, CLOCK_REFRESH_MS);
  return function stop() {
    clearInterval(timer);
  };
}

export async function runMunshiSuite(
  plan: MunshiRunPlan,
  deps: MunshiRunnerDeps,
): Promise<RunOutcome> {
  const rows = buildMunshiEvalRows(plan.cases, plan.data);
  await deps.db.insertRows(rows);
  const ownerCallIds = [...rows.byCase.values()].map((item) => item.ownerCallId);
  try {
    const suite = munshiSuite(plan, rows);
    const { suiteId, caseIds } = await deps.sarvam.createSuite(suite);
    await deps.sarvam.mapVariables(
      suiteId,
      plan.agent,
      suite.variables.map((item) => item.name),
    );
    const runId = await deps.sarvam.startRun(suiteId, plan.agent, plan.suiteName);
    deps.onProgress?.(`suite ${suiteId}, run ${runId}`);
    const beforePoll = (): Promise<void> => refreshCallClocks(plan.cases, rows, deps);
    const stopClocks = keepCallClocks(beforePoll, deps.onProgress);
    try {
      await waitForRun({ ...deps, beforePoll }, suiteId, runId);
    } finally {
      stopClocks();
    }
    const results: CaseResult[] = [];
    // One case at a time: reading all 16 at once hit Sarvam's rate limit (2026-11-20 run).
    for (const evalCase of plan.cases) {
      const ref = { suiteId, runId, caseId: caseIds.get(evalCase.id), rows };
      results.push(await resultFor(evalCase, ref, deps));
    }
    return { suiteId, runId, results };
  } finally {
    await deps.db.closeOwnerCalls(ownerCallIds, deps.now());
  }
}
