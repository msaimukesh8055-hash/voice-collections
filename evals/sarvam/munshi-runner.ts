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
import { checkMunshiCall } from './munshi-checks.ts';
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
  const checks = checkMunshiCall(evalCase, { outcome, ids: caseRows.ids }, evidence);
  const judged = { verdicts, checks };
  return {
    id: evalCase.id,
    name: evalCase.name,
    category: evalCase.category,
    ...judged,
    transcript: execution?.transcript ?? [],
    // A case Sarvam returned no verdicts for cannot count as a pass.
    passed: verdicts.length > 0 && casePassed(judged),
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
    await waitForRun(deps, suiteId, runId);
    const results = await Promise.all(
      plan.cases.map((evalCase) =>
        resultFor(evalCase, { suiteId, runId, caseId: caseIds.get(evalCase.id), rows }, deps),
      ),
    );
    return { suiteId, runId, results };
  } finally {
    await deps.db.closeOwnerCalls(ownerCallIds, deps.now());
  }
}
