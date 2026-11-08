// evals/munshi/run.ts
// npm run evals:munshi — Munshi's 15 text evals (M8 C1). Live by default: Munshi on Sarvam
// sarvam-105b, the owner and the judge on Gemini (owner falls back to Sarvam); needs
// SARVAM_API_KEY and GEMINI_API_KEY in .env. Writes evals/munshi/results/<date>.json and prints
// the summary table; exits 1 unless the pass rule holds.
//   --dry           fake models, no network, nothing written (checks the plumbing only)
//   --only 01,04    run just these scenarios (re-checking one scenario costs ~1/15 of a run)
// Prints ids, counts and fake demo figures only, never a key.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { istDate } from '../../supabase/functions/_shared/clock.ts';
import { GEMINI_MODEL, SARVAM_MODEL } from '../../supabase/functions/_shared/llm/json-llm.ts';
import { logToConsole } from '../../supabase/functions/_shared/log.ts';
import { MUNSHI_SIMULATED_VERSION } from '../../supabase/functions/_shared/simulator/munshi-text.ts';
import { OWNER_PERSONA_VERSION } from '../../supabase/functions/_shared/simulator/owner-persona.ts';
import { requireEnv, sleep } from '../../scripts/lib/smoke.ts';
import { JUDGE_PROMPT_VERSION } from './judge.ts';
import { dryModels, type EvalModels, liveModels } from './llms.ts';
import { formatTable, resultFileName, summarise } from './report.ts';
import { runEvals, type ScenarioResult } from './runner.ts';
import { MUNSHI_SCENARIOS } from './scenarios.ts';

const RESULTS_DIR = join(import.meta.dirname, 'results');

function argAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function chosenScenarios(): typeof MUNSHI_SCENARIOS {
  const only = argAfter('--only');
  if (only === null) return MUNSHI_SCENARIOS;
  const ids = new Set(only.split(','));
  return MUNSHI_SCENARIOS.filter((scenario) => ids.has(scenario.id));
}

function liveModelsFromEnv(): () => EvalModels {
  const models = liveModels(
    {
      sarvamApiKey: requireEnv('SARVAM_API_KEY'),
      geminiApiKey: requireEnv('GEMINI_API_KEY'),
      fetchImpl: fetch,
      log: logToConsole,
    },
    { now: Date.now, sleep },
  );
  return () => models;
}

function progress(result: ScenarioResult): void {
  const failed = result.checks.filter((check) => !check.passed).length;
  process.stdout.write(
    `${result.id} ${result.end}, ${result.tools.length} tools, ${failed} checks failed\n`,
  );
}

function writeResults(
  results: readonly ScenarioResult[],
  summary: ReturnType<typeof summarise>,
): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const date = istDate(new Date());
  const name = resultFileName(date, (candidate) => existsSync(join(RESULTS_DIR, candidate)));
  const versions = {
    munshi: MUNSHI_SIMULATED_VERSION,
    ownerPersona: OWNER_PERSONA_VERSION,
    judge: JUDGE_PROMPT_VERSION,
  };
  const models = { munshi: SARVAM_MODEL, owner: [GEMINI_MODEL, SARVAM_MODEL], judge: GEMINI_MODEL };
  const body = { ranAt: new Date().toISOString(), versions, models, summary, scenarios: results };
  writeFileSync(join(RESULTS_DIR, name), `${JSON.stringify(body, null, 2)}\n`);
  return join('evals', 'munshi', 'results', name);
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const scenarios = chosenScenarios();
  const modelsFor = dry ? dryModels : liveModelsFromEnv();
  process.stdout.write(
    `${dry ? 'DRY RUN (fake models; not a measurement)' : 'Live run'}: ${scenarios.length} scenarios\n`,
  );
  const results = await runEvals(scenarios, { modelsFor, log: logToConsole, onResult: progress });
  const summary = summarise(results);
  process.stdout.write(`\n${formatTable(results, summary)}`);
  if (dry) return;
  process.stdout.write(`Results: ${writeResults(results, summary)}\n`);
  if (!summary.passed) process.exitCode = 1;
}

await main();
