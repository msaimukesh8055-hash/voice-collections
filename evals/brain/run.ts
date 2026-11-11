// evals/brain/run.ts
// npm run evals:brain — the WhatsApp brain's 21 messages (M9 Build C2), through the same
// interpret() the bot uses: fixed commands in code first, then Sarvam sarvam-105b, then Gemini.
// Prints the table, stores the run for the dashboard's Evals page and exits 1 unless the gate
// passes. Costs a few LLM calls (only the messages code cannot read). Needs SARVAM_API_KEY,
// GEMINI_API_KEY, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env. Never prints a key.
//   --no-store   do not write the run to the database
import { createHash } from 'node:crypto';
import { interpret } from '../../supabase/functions/_shared/brain/interpret.ts';
import { createBrainLlm } from '../../supabase/functions/_shared/brain/llm.ts';
import {
  BRAIN_PROMPT_VERSION,
  buildBrainPrompt,
} from '../../supabase/functions/_shared/brain/prompt.ts';
import { istDate } from '../../supabase/functions/_shared/clock.ts';
import { requireEnv } from '../../scripts/lib/smoke.ts';
import { createEvalDb } from '../sarvam/eval-db.ts';
import { BRAIN_CASES, KNOWN_NAMES } from './cases.ts';
import { type BrainResult, checkAnswer, formatTable, summarise } from './check.ts';

const HASH_LENGTH = 16;

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function quietLog(): void {
  // LLM timings are not part of this report; failures show up as a wrong answer.
}

async function answerAll(now: Date): Promise<readonly BrainResult[]> {
  const llm = createBrainLlm({
    sarvamApiKey: requireEnv('SARVAM_API_KEY'),
    geminiApiKey: requireEnv('GEMINI_API_KEY'),
    fetchImpl: fetch,
    log: quietLog,
  });
  const deps = {
    today: istDate(now),
    now,
    llm,
    isKnownName: (name: string) => KNOWN_NAMES.includes(name.trim().toLowerCase()),
  };
  const results: BrainResult[] = [];
  // One at a time: Gemini's free tier allows only a few requests a minute.
  for (const evalCase of BRAIN_CASES) {
    const answer = await interpret(evalCase.text, deps);
    const result = checkAnswer(evalCase, { command: answer.command, path: answer.path });
    results.push(result);
    write(`${result.id} ${result.passed ? 'ok' : 'FAIL'} (${result.path})`);
  }
  return results;
}

async function store(results: readonly BrainResult[], now: Date): Promise<string> {
  const db = createEvalDb({
    supabaseUrl: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    fetchImpl: fetch,
  });
  const summary = summarise(results);
  const prompt = buildBrainPrompt(now);
  return await db.saveRun({
    target: 'brain',
    promptHash: createHash('sha256').update(prompt).digest('hex').slice(0, HASH_LENGTH),
    metrics: { kind: 'code-checks', promptVersion: BRAIN_PROMPT_VERSION, ...summary },
    results: results.map((result) => ({
      scenarioId: result.id,
      scores: {
        name: result.text,
        category: result.money ? 'money' : 'read',
        verdicts: [],
        checks: [
          {
            id: `understood_as_${result.got}`,
            critical: result.money,
            passed: result.passed,
            detail: result.detail,
          },
        ],
        path: result.path,
      },
      transcript: `owner: ${result.text}\nbrain (${result.path}): ${result.got}`,
      pass: result.passed,
    })),
  });
}

async function main(): Promise<void> {
  const now = new Date();
  write(`Brain: ${BRAIN_CASES.length} messages`);
  const results = await answerAll(now);
  const summary = summarise(results);
  write(`\n${formatTable(results, summary)}`);
  if (!process.argv.includes('--no-store'))
    write(`Stored as eval run ${await store(results, now)}`);
  if (!summary.passed) process.exitCode = 1;
}

await main();
