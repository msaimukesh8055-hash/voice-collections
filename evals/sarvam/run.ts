// evals/sarvam/run.ts
// npm run evals:asha -- --version <n>   Asha's 9 cases on Sarvam Tests (M9 Build C).
// Creates fake eval shopkeepers with their own call tokens, runs the suite against the given
// agent version (a draft works), checks our database afterwards, prints the table, stores the run
// for the dashboard's Evals page and exits 1 unless the release gate passes.
//   --only asha-03,asha-07   run just these cases
//   --resume <suite>,<run>   collect a run that was already started (no new spend)
// Each run spends Sarvam credits (text conversations). Needs SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, SARVAM_AGENTS_API_KEY, SARVAM_ORG_ID, SARVAM_WORKSPACE_ID and
// SARVAM_APP_ID in .env. Prints ids, counts and fake eval data only, never a key.
import { createHash, randomUUID } from 'node:crypto';
import { istDate, resolveNow } from '../../supabase/functions/_shared/clock.ts';
import { requireEnv, sleep } from '../../scripts/lib/smoke.ts';
import { ASHA_PROMPT, PROMPT_VERSION } from '../../voice-agents/asha/prompt.ts';
import { ASHA_CASES, ASHA_GUARDRAILS } from './asha-cases.ts';
import { createSarvamTests, type SarvamTests } from './client.ts';
import { createEvalDb, type EvalDb } from './eval-db.ts';
import { summarise } from './gate.ts';
import { formatTable, toStoredRun } from './report.ts';
import { resumeRun, runSuite } from './runner.ts';

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

function chosenCases(): typeof ASHA_CASES {
  const only = argAfter('--only');
  if (only === null) return ASHA_CASES;
  const ids = new Set(only.split(','));
  return ASHA_CASES.filter((evalCase) => ids.has(evalCase.id));
}

function agentVersion(): number {
  const version = Number(argAfter('--version'));
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('Pass the agent version to test: --version <number>');
  }
  return version;
}

/** --resume <suite id>,<run id>: read a run that was already started instead of paying again. */
function startedRun(): { suiteId: string; runId: string } | null {
  const [suiteId, runId] = (argAfter('--resume') ?? '').split(',');
  return suiteId && runId ? { suiteId, runId } : null;
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function clients(): { db: EvalDb; sarvam: SarvamTests } {
  const db = createEvalDb({
    supabaseUrl: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    fetchImpl: fetch,
  });
  const sarvam = createSarvamTests({
    apiKey: requireEnv('SARVAM_AGENTS_API_KEY'),
    orgId: requireEnv('SARVAM_ORG_ID'),
    workspaceId: requireEnv('SARVAM_WORKSPACE_ID'),
    fetchImpl: fetch,
    sleep,
    onWait: (seconds) => write(`Sarvam rate limit: waiting ${seconds} s`),
  });
  return { db, sarvam };
}

async function main(): Promise<void> {
  const cases = chosenCases();
  const agent = { appId: requireEnv('SARVAM_APP_ID'), appVersion: agentVersion() };
  const { db, sarvam } = clients();
  const now = new Date();
  const today = istDate(resolveNow(await db.getDemoClock(), now));
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  write(`Asha ${PROMPT_VERSION}, agent version ${agent.appVersion}: ${cases.length} cases`);
  const deps = { sarvam, db, sleep, now: () => new Date(), onProgress: write };
  const started = startedRun();
  const outcome = started
    ? await resumeRun(cases, started, deps)
    : await runSuite(
        {
          agent,
          suiteName: `asha-evals-${stamp}`,
          cases,
          guardrails: ASHA_GUARDRAILS,
          sharedVariables: [
            { name: 'business_name', value: OWNER.businessName },
            { name: 'owner_name', value: OWNER.shortName },
            { name: 'today', value: today },
          ],
          data: { today, now, newId: randomUUID, owner: OWNER },
        },
        deps,
      );
  const summary = summarise(outcome.results);
  write(`\n${formatTable(outcome.results, summary)}`);
  const promptHash = createHash('sha256').update(ASHA_PROMPT).digest('hex').slice(0, HASH_LENGTH);
  const info = {
    target: 'asha',
    promptHash,
    kind: 'sarvam-tests',
    detail: {
      promptVersion: PROMPT_VERSION,
      appId: agent.appId,
      appVersion: agent.appVersion,
      suiteId: outcome.suiteId,
      runId: outcome.runId,
    },
  };
  write(`Stored as eval run ${await db.saveRun(toStoredRun(info, outcome.results, summary))}`);
  if (!summary.passed) process.exitCode = 1;
}

await main();
