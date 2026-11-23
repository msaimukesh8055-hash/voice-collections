// evals/brain/bakeoff-run.ts
// npm run evals:bakeoff — the model bake-off (Saim, 2026-11-23): every WhatsApp brain eval message
// through each model in BAKEOFF_MODELS alone (no fallback, no code parser first), with the same
// prompt and checker as evals:brain. Prints one line per model and stores one eval run per model
// (target "brain-model") for the Evals page's "Model choice" table. Costs a few paise of Sarvam
// tokens; Gemini runs on the free tier, so its calls are spaced out. Needs SARVAM_API_KEY,
// GEMINI_API_KEY, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env. Never prints a key.
//   --only sarvam-105b   run just this model
//   --no-store           do not write the runs to the database
import { createHash } from 'node:crypto';
import {
  BRAIN_PROMPT_VERSION,
  buildBrainPrompt,
} from '../../supabase/functions/_shared/brain/prompt.ts';
import { istDate } from '../../supabase/functions/_shared/clock.ts';
import {
  askGeminiChat,
  askSarvamChat,
  type ChatRequest,
  LLM_USAGE_EVENT,
} from '../../supabase/functions/_shared/llm/json-llm.ts';
import type { LogFields, LogLevel } from '../../supabase/functions/_shared/log.ts';
import { requireEnv, sleep } from '../../scripts/lib/smoke.ts';
import { createEvalDb, type StoredRun } from '../sarvam/eval-db.ts';
import {
  BAKEOFF_MODELS,
  type BakeoffModel,
  type BakeoffResult,
  judgeReply,
  type ModelReply,
  type ModelSummary,
  summariseModel,
} from './bakeoff.ts';
import { BRAIN_CASES } from './cases.ts';

const HASH_LENGTH = 16;
const MAX_TOKENS = 300;
/** Gemini's free tier allows about 10 requests a minute. */
const GEMINI_GAP_MS = 7_000;
const RATE_LIMIT_WAIT_MS = 40_000;

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function argAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

interface Usage {
  tokensIn: number;
  tokensOut: number;
}

async function askOnce(model: BakeoffModel, request: ChatRequest): Promise<ModelReply> {
  const usage: Usage = { tokensIn: 0, tokensOut: 0 };
  function log(_level: LogLevel, event: string, fields: LogFields = {}): void {
    if (event !== LLM_USAGE_EVENT) return;
    usage.tokensIn = Number(fields['tokens_in'] ?? 0);
    usage.tokensOut = Number(fields['tokens_out'] ?? 0);
  }
  const config = {
    sarvamApiKey: requireEnv('SARVAM_API_KEY'),
    geminiApiKey: requireEnv('GEMINI_API_KEY'),
    fetchImpl: fetch,
    log,
  };
  const started = Date.now();
  const content =
    model.provider === 'sarvam'
      ? await askSarvamChat(config, { ...request, model: model.id })
      : await askGeminiChat(config, request);
  return { content, ms: Date.now() - started, ...usage };
}

/** One message to one model; a rate limit is waited out once, any other failure is a miss. */
async function ask(model: BakeoffModel, request: ChatRequest): Promise<ModelReply> {
  for (const attempt of [1, 2]) {
    try {
      return await askOnce(model, request);
    } catch (error) {
      const limited = error instanceof Error && error.message.includes('429');
      if (!limited || attempt === 2) {
        write(`  call failed: ${error instanceof Error ? error.message : 'unknown'}`);
        return { content: null, ms: 0, tokensIn: 0, tokensOut: 0 };
      }
      write(`  rate limited: waiting ${RATE_LIMIT_WAIT_MS / 1000} s`);
      await sleep(RATE_LIMIT_WAIT_MS);
    }
  }
  return { content: null, ms: 0, tokensIn: 0, tokensOut: 0 };
}

async function runModel(model: BakeoffModel, now: Date): Promise<readonly BakeoffResult[]> {
  const system = buildBrainPrompt(now);
  const today = istDate(now);
  const results: BakeoffResult[] = [];
  for (const evalCase of BRAIN_CASES) {
    const request = {
      system,
      messages: [{ role: 'user' as const, content: evalCase.text }],
      maxTokens: MAX_TOKENS,
    };
    const reply = await ask(model, request);
    const result = judgeReply(evalCase, reply, { today, model: model.id });
    results.push(result);
    write(
      `  ${result.id} ${result.passed ? 'ok' : 'FAIL'} ${result.ms} ms ${result.detail}`.trimEnd(),
    );
    if (model.provider === 'gemini') await sleep(GEMINI_GAP_MS);
  }
  return results;
}

function line(summary: ModelSummary): string {
  return (
    `${summary.model}: ${summary.casesPassed}/${summary.cases} · money wrong ${summary.moneyFailures} · ` +
    `Telugu/Hindi ${summary.indicPassed}/${summary.indicCases} · typical ${summary.p50Ms} ms · ` +
    `slowest ${summary.maxMs} ms · ₹${summary.costPer1000Inr} per 1,000 · ` +
    `${summary.passed ? 'GATE PASSED' : `GATE FAILED: ${summary.reasons.join('; ')}`}`
  );
}

function stored(results: readonly BakeoffResult[]): StoredRun['results'] {
  return results.map((result) => ({
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
      got: {
        kind: result.got === 'none' ? null : result.got,
        name: result.gotName,
        amount: result.gotAmount,
      },
      ms: result.ms,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    },
    transcript: `owner: ${result.text}\nbrain (${result.path}): ${result.got}`,
    pass: result.passed,
  }));
}

async function main(): Promise<void> {
  const now = new Date();
  const only = argAfter('--only');
  const models = BAKEOFF_MODELS.filter((model) => only === null || model.id === only);
  const prompt = buildBrainPrompt(now);
  const promptHash = createHash('sha256').update(prompt).digest('hex').slice(0, HASH_LENGTH);
  const db = createEvalDb({
    supabaseUrl: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    fetchImpl: fetch,
  });
  for (const model of models) {
    write(`${model.id}: ${BRAIN_CASES.length} messages`);
    const results = await runModel(model, now);
    const summary = summariseModel(model, BRAIN_CASES, results);
    write(line(summary));
    if (process.argv.includes('--no-store')) continue;
    const id = await db.saveRun({
      target: 'brain-model',
      promptHash,
      metrics: { kind: 'model-bakeoff', promptVersion: BRAIN_PROMPT_VERSION, ...summary },
      results: stored(results),
    });
    write(`Stored as eval run ${id}`);
  }
}

await main();
