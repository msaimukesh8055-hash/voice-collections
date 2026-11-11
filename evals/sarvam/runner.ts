// evals/sarvam/runner.ts
// One eval run from start to finish (M9 Build C): create the fake shopkeepers and call tokens,
// build the suite in Sarvam with each case pointed at its own token, run it, wait, then combine
// Sarvam's verdicts with our own database checks into case results. The calls are always closed
// at the end, also when the run fails, so no eval token stays usable.
import { checkCall } from './checks.ts';
import type { AgentVersion, NewSuite, SarvamTests, SuiteVariable } from './client.ts';
import {
  buildEvalRows,
  type EvalDataOptions,
  type EvalIds,
  type EvalRows,
  outstandingOf,
} from './eval-data.ts';
import type { EvalDb } from './eval-db.ts';
import { casePassed } from './gate.ts';
import type { CaseResult, EvalCase } from './types.ts';

export const CALL_TOKEN = 'call_token';
const POLL_EVERY_MS = 15_000;
/** Text conversations finish in about a minute; well inside the 10-minute token window. */
const MAX_WAIT_MS = 8 * 60 * 1000;

export interface RunPlan {
  readonly agent: AgentVersion;
  readonly suiteName: string;
  readonly cases: readonly EvalCase[];
  readonly guardrails: readonly string[];
  /** Agent variables every case shares (business name, owner name, today). */
  readonly sharedVariables: readonly SuiteVariable[];
  readonly data: EvalDataOptions;
}

export interface RunnerDeps {
  readonly sarvam: SarvamTests;
  readonly db: EvalDb;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => Date;
  readonly onProgress?: (line: string) => void;
}

export interface RunOutcome {
  readonly suiteId: string;
  readonly runId: string;
  readonly results: readonly CaseResult[];
}

export class EvalRunError extends Error {
  override name = 'EvalRunError';
}

function suiteFor(plan: RunPlan, rows: EvalRows): NewSuite {
  // Placeholders for the per-case variables, so the mapping to the agent has all its names.
  const perCase = [CALL_TOKEN, 'shopkeeper_name', 'shop_name'].map((name) => ({
    name,
    value: '-',
  }));
  return {
    name: plan.suiteName,
    description: 'Created by evals/sarvam/run.ts. Fake data; each case has its own eval call.',
    variables: [...plan.sharedVariables, ...perCase],
    global_guardrails: plan.guardrails,
    test_cases: plan.cases.map((evalCase) => ({
      name: evalCase.id,
      category: evalCase.category,
      user_scenario: evalCase.scenario,
      expected_behaviors: evalCase.behaviours,
      max_turns: evalCase.maxTurns,
      variable_overrides: [
        { name: CALL_TOKEN, value: rows.byCase.get(evalCase.id)?.callId ?? '' },
        { name: 'shopkeeper_name', value: evalCase.setup.shopkeeperName },
        { name: 'shop_name', value: evalCase.setup.shopName },
      ],
    })),
  };
}

async function waitForRun(deps: RunnerDeps, suiteId: string, runId: string): Promise<void> {
  const deadline = deps.now().getTime() + MAX_WAIT_MS;
  while (deps.now().getTime() < deadline) {
    const run = await deps.sarvam.getRun(suiteId, runId);
    deps.onProgress?.(`run ${run.status}: ${run.completed} of ${run.total} conversations`);
    if (run.status === 'completed') return;
    if (run.status === 'failed') throw new EvalRunError('Sarvam reported the run as failed');
    await deps.sleep(POLL_EVERY_MS);
  }
  throw new EvalRunError('the run did not finish in time');
}

async function resultFor(
  evalCase: EvalCase,
  ref: {
    suiteId: string;
    runId: string;
    caseId: string | undefined;
    rows: Pick<EvalRows, 'byCase'>;
  },
  deps: RunnerDeps,
): Promise<CaseResult> {
  const ids = ref.rows.byCase.get(evalCase.id);
  if (!ids || !ref.caseId) throw new EvalRunError(`case ${evalCase.id} is missing from the suite`);
  const [executions, evidence] = await Promise.all([
    deps.sarvam.getCaseResults(ref.suiteId, { runId: ref.runId, caseId: ref.caseId }),
    deps.db.readEvidence(ids, outstandingOf(evalCase)),
  ]);
  const execution = executions[0];
  const verdicts = execution?.verdicts ?? [];
  const checks = checkCall(evalCase, evidence);
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

interface RunRef {
  readonly suiteId: string;
  readonly runId: string;
  readonly caseIds: ReadonlyMap<string, string>;
  readonly rows: Pick<EvalRows, 'byCase'>;
}

async function finishRun(
  cases: readonly EvalCase[],
  ref: RunRef,
  deps: RunnerDeps,
): Promise<RunOutcome> {
  await waitForRun(deps, ref.suiteId, ref.runId);
  const results = await Promise.all(
    cases.map((evalCase) =>
      resultFor(evalCase, { ...ref, caseId: ref.caseIds.get(evalCase.id) }, deps),
    ),
  );
  return { suiteId: ref.suiteId, runId: ref.runId, results };
}

export async function runSuite(plan: RunPlan, deps: RunnerDeps): Promise<RunOutcome> {
  const rows = buildEvalRows(plan.cases, plan.data);
  await deps.db.insertRows(rows);
  const callIds = [...rows.byCase.values()].map((ids) => ids.callId);
  try {
    const suite = suiteFor(plan, rows);
    const { suiteId, caseIds } = await deps.sarvam.createSuite(suite);
    await deps.sarvam.mapVariables(
      suiteId,
      plan.agent,
      suite.variables.map((item) => item.name),
    );
    const runId = await deps.sarvam.startRun(suiteId, plan.agent, plan.suiteName);
    deps.onProgress?.(`suite ${suiteId}, run ${runId}`);
    return await finishRun(plan.cases, { suiteId, runId, caseIds, rows }, deps);
  } finally {
    await deps.db.closeCalls(callIds, deps.now());
  }
}

/**
 * Picks up a run that was started earlier (the script died, the network dropped): the run is
 * already paid for, so its results are read instead of running it again. Each case's call token
 * comes from the suite stored in Sarvam, and its shopkeeper from our own call row.
 */
export async function resumeRun(
  cases: readonly EvalCase[],
  started: { readonly suiteId: string; readonly runId: string },
  deps: RunnerDeps,
): Promise<RunOutcome> {
  const stored = await deps.sarvam.listCases(started.suiteId);
  const byCase = new Map<string, EvalIds>();
  const caseIds = new Map<string, string>();
  for (const item of stored) {
    const callId = item.variables.get(CALL_TOKEN);
    const shopkeeperId = callId ? await deps.db.findShopkeeper(callId) : null;
    if (!callId || !shopkeeperId) continue;
    byCase.set(item.name, { callId, shopkeeperId });
    caseIds.set(item.name, item.caseId);
  }
  const known = cases.filter((evalCase) => byCase.has(evalCase.id));
  if (known.length === 0) throw new EvalRunError('none of the suite cases match an eval call');
  const callIds = [...byCase.values()].map((ids) => ids.callId);
  try {
    return await finishRun(known, { ...started, caseIds, rows: { byCase } }, deps);
  } finally {
    await deps.db.closeCalls(callIds, deps.now());
  }
}
