// evals/sarvam/munshi-run.ts
// npm run evals:munshi-sarvam -- --version <n>   Munshi's 16 cases on Sarvam Tests (M9 Build F).
// Creates one flagged eval owner per case (fake book + owner-call token), runs the suite against
// the given Munshi agent version (a draft works), checks our database afterwards, prints the
// table, stores the run (target "munshi") and exits 1 unless the release gate passes.
//   --only munshi-04,munshi-07   run just these cases
//   --plan                       free: build the rows and the suite, print counts, send nothing
// Each run spends Sarvam credits (about Rs 1.8 per case, measured on Asha's runs). Needs
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SARVAM_AGENTS_API_KEY, SARVAM_ORG_ID,
// SARVAM_WORKSPACE_ID and SARVAM_MUNSHI_APP_ID in .env. Prints ids, counts and fake data only.
import { createHash, randomUUID } from 'node:crypto';
import { istDayLabel, resolveNow } from '../../supabase/functions/_shared/clock.ts';
import { requireEnv, sleep } from '../../scripts/lib/smoke.ts';
import { MUNSHI_PROMPT } from '../../voice-agents/munshi/prompt.ts';
import { createSarvamTests, type SarvamTests } from './client.ts';
import { createEvalDb } from './eval-db.ts';
import { summarise } from './gate.ts';
import { MUNSHI_CASES, MUNSHI_GUARDRAILS } from './munshi-cases.ts';
import { createMunshiEvalDb } from './munshi-eval-db.ts';
import { buildMunshiEvalRows } from './munshi-eval-data.ts';
import { type MunshiRunPlan, munshiSuite, runMunshiSuite } from './munshi-runner.ts';
import { formatTable, toStoredRun } from './report.ts';
import { serverClock } from './server-clock.ts';

const OWNER = {
  name: 'Srinivas Reddy',
  shortName: 'Srinivas',
  businessName: 'Sri Lakshmi Traders',
};
const HASH_LENGTH = 16;

function argAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function chosenCases(): typeof MUNSHI_CASES {
  const only = argAfter('--only');
  if (only === null) return MUNSHI_CASES;
  const ids = new Set(only.split(','));
  return MUNSHI_CASES.filter((evalCase) => ids.has(evalCase.id));
}

function agentVersion(): number {
  const version = Number(argAfter('--version'));
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('Pass the Munshi agent version to test: --version <number>');
  }
  return version;
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

interface PlanInput {
  readonly today: string;
  readonly now: Date;
  readonly stamp: string;
  readonly appId: string;
  readonly version: number;
}

function planFor({ today, now, stamp, appId, version }: PlanInput): MunshiRunPlan {
  return {
    agent: { appId, appVersion: version },
    suiteName: `munshi-evals-${stamp}`,
    cases: chosenCases(),
    guardrails: MUNSHI_GUARDRAILS,
    sharedVariables: [
      { name: 'owner_short_name', value: OWNER.shortName },
      { name: 'owner_name', value: OWNER.name },
      { name: 'business_name', value: OWNER.businessName },
      { name: 'today', value: today },
    ],
    data: { now, newId: randomUUID, runLabel: `munshi-${stamp}`, owner: OWNER },
  };
}

/** --plan: what a run would create and send, with no database or Sarvam call. */
function printPlan(plan: MunshiRunPlan): void {
  const rows = buildMunshiEvalRows(plan.cases, plan.data);
  const suite = munshiSuite(plan, rows);
  write(`PLAN ONLY (nothing sent): ${plan.cases.length} cases`);
  write(
    `rows: ${rows.owners.length} eval owners, ${rows.shopkeepers.length} shopkeepers, ` +
      `${rows.entries.length} entries, ${rows.calls.length} past calls, ` +
      `${rows.promises.length} promises, ${rows.followups.length} follow-ups, ` +
      `${rows.ownerCalls.length} owner calls`,
  );
  write(
    `suite: ${suite.test_cases.length} cases, variables ${suite.variables.map((v) => v.name).join(', ')}`,
  );
  for (const item of suite.test_cases) {
    write(
      `  ${item.name}: ${item.expected_behaviors.map((behaviour) => behaviour.name).join(' · ')}`,
    );
  }
}

function sarvamFromEnv(): SarvamTests {
  return createSarvamTests({
    apiKey: requireEnv('SARVAM_AGENTS_API_KEY'),
    orgId: requireEnv('SARVAM_ORG_ID'),
    workspaceId: requireEnv('SARVAM_WORKSPACE_ID'),
    fetchImpl: fetch,
    sleep,
    onWait: (seconds) => write(`Sarvam rate limit: waiting ${seconds} s`),
  });
}

function printPlanOnly(): void {
  const at = new Date();
  const stamp = at.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  printPlan(planFor({ today: istDayLabel(at), now: at, stamp, appId: 'plan-only', version: 1 }));
}

async function main(): Promise<void> {
  if (process.argv.includes('--plan')) {
    printPlanOnly();
    return;
  }
  const config = {
    supabaseUrl: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    fetchImpl: fetch,
  };
  const clock = await serverClock(config.supabaseUrl, write);
  const now = clock();
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const store = createEvalDb(config);
  const today = istDayLabel(resolveNow(await store.getDemoClock(), now));
  const plan = planFor({
    today,
    now,
    stamp,
    appId: requireEnv('SARVAM_MUNSHI_APP_ID'),
    version: agentVersion(),
  });
  const sarvam = sarvamFromEnv();
  write(`Munshi, agent version ${plan.agent.appVersion}: ${plan.cases.length} cases`);
  const outcome = await runMunshiSuite(plan, {
    sarvam,
    db: createMunshiEvalDb(config),
    sleep,
    now: clock,
    onProgress: write,
  });
  const summary = summarise(outcome.results);
  write(`\n${formatTable(outcome.results, summary)}`);
  const promptHash = createHash('sha256').update(MUNSHI_PROMPT).digest('hex').slice(0, HASH_LENGTH);
  const info = {
    target: 'munshi',
    promptHash,
    kind: 'sarvam-tests',
    detail: {
      appId: plan.agent.appId,
      appVersion: plan.agent.appVersion,
      suiteId: outcome.suiteId,
      runId: outcome.runId,
      evalRun: plan.data.runLabel,
    },
  };
  write(`Stored as eval run ${await store.saveRun(toStoredRun(info, outcome.results, summary))}`);
  if (!summary.passed) process.exitCode = 1;
}

await main();
