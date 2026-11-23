// evals/brain/bakeoff.ts
// Model bake-off for the WhatsApp brain (Saim, 2026-11-23): the same brain prompt and the same
// checker (check.ts) on every eval message, sent straight to one model with no fallback and no
// code parser first, so each model answers all of them. This file is the pure part: what one
// answer becomes, and how one model's answers sum up (accuracy, money mistakes, Telugu/Hindi,
// latency, cost per 1,000 messages). The network part is bakeoff-run.ts.
import {
  keepsWrittenAmount,
  notAPromise,
} from '../../supabase/functions/_shared/brain/interpret.ts';
import { parseSuggestion, toCommand } from '../../supabase/functions/_shared/brain/suggestion.ts';
import { GST } from '../../supabase/functions/_shared/calls/cost.ts';
import type { BrainCase } from './cases.ts';
import { type BrainResult, checkAnswer, summarise } from './check.ts';

export interface BakeoffModel {
  readonly id: string;
  readonly provider: 'sarvam' | 'gemini';
  /** ₹ per 1M tokens before GST: input, output. */
  readonly inrPerMillion: { readonly input: number; readonly output: number };
  /** Where the price came from, shown under the table. */
  readonly priceNote: string;
}

const SARVAM_PRICE = { input: 10, output: 25 } as const;
const SARVAM_NOTE =
  'Sarvam price page, read 2026-11-23: ₹10 in / ₹25 out per 1M tokens, introductory to end-2026, + GST.';

/** sarvam-30b and sarvam-m answered "deprecated" on 2026-11-23: Sarvam's chat API now serves
 * only sarvam-105b and its chat variant, so the variant is the second Sarvam model. */
export const BAKEOFF_MODELS: readonly BakeoffModel[] = [
  { id: 'sarvam-105b', provider: 'sarvam', inrPerMillion: SARVAM_PRICE, priceNote: SARVAM_NOTE },
  {
    id: 'sarvam-105b-conversations',
    provider: 'sarvam',
    inrPerMillion: SARVAM_PRICE,
    priceNote: SARVAM_NOTE,
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    inrPerMillion: { input: 0, output: 0 },
    priceNote: 'Gemini free tier: ₹0, but only a few requests a minute (not production volume).',
  },
];

/** One model's raw answer to one message. */
export interface ModelReply {
  /** Null when the call failed (HTTP error, timeout, odd body). */
  readonly content: string | null;
  readonly ms: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
}

export interface BakeoffResult extends BrainResult {
  readonly ms: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  /** The call itself failed (no answer at all). */
  readonly callFailed: boolean;
}

/** As production treats a model's answer (interpret.ts): parse it, then the same two guards. */
export function judgeReply(
  evalCase: BrainCase,
  reply: ModelReply,
  meta: { readonly today: string; readonly model: string },
): BakeoffResult {
  const suggestion = reply.content === null ? null : parseSuggestion(reply.content);
  const suggested = suggestion ? toCommand(suggestion, meta.today) : null;
  const command = notAPromise(keepsWrittenAmount(suggested, evalCase.text), evalCase.text);
  const checked = checkAnswer(evalCase, { command, path: meta.model });
  // No answer is never a pass, even where "no command" was the expected result (brain-23).
  const answered =
    reply.content === null
      ? { ...checked, passed: false, detail: 'no answer (the call failed)' }
      : checked;
  return {
    ...answered,
    ms: reply.ms,
    tokensIn: reply.tokensIn,
    tokensOut: reply.tokensOut,
    callFailed: reply.content === null,
  };
}

/** The middle value (typical) of a list of times; 0 for none. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return Math.round(((sorted[middle - 1] ?? 0) + upper) / 2);
}

const PER_THOUSAND = 1000;
const TOKENS_PER_UNIT = 1_000_000;

/** ₹ for 1,000 messages like these, with GST, from the average tokens per message. */
export function costPerThousand(model: BakeoffModel, results: readonly BakeoffResult[]): number {
  if (results.length === 0) return 0;
  const tokensIn = results.reduce((sum, one) => sum + one.tokensIn, 0) / results.length;
  const tokensOut = results.reduce((sum, one) => sum + one.tokensOut, 0) / results.length;
  const { input, output } = model.inrPerMillion;
  const perMessage = (tokensIn * input + tokensOut * output) / TOKENS_PER_UNIT;
  return Math.round(perMessage * PER_THOUSAND * (1 + GST) * 100) / 100;
}

/** A message in Telugu or Hindi (it has an English meaning written next to it). */
export function isIndic(evalCase: BrainCase): boolean {
  return evalCase.meaning !== undefined;
}

export interface ModelSummary {
  readonly model: string;
  readonly provider: string;
  readonly cases: number;
  readonly casesPassed: number;
  readonly moneyCases: number;
  readonly moneyFailures: number;
  readonly indicCases: number;
  readonly indicPassed: number;
  readonly failedCalls: number;
  readonly p50Ms: number;
  readonly maxMs: number;
  readonly avgTokensIn: number;
  readonly avgTokensOut: number;
  readonly costPer1000Inr: number;
  readonly priceNote: string;
  /** The brain's release gate on this model alone (every money case right, ≥ 90% overall). */
  readonly passed: boolean;
  readonly reasons: readonly string[];
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, one) => sum + one, 0) / values.length);
}

export function summariseModel(
  model: BakeoffModel,
  cases: readonly BrainCase[],
  results: readonly BakeoffResult[],
): ModelSummary {
  const gate = summarise(results);
  const indicIds = new Set(cases.filter(isIndic).map((one) => one.id));
  const indic = results.filter((one) => indicIds.has(one.id));
  const replied = results.filter((one) => !one.callFailed);
  const answered = replied.map((one) => one.ms);
  return {
    model: model.id,
    provider: model.provider,
    cases: gate.cases,
    casesPassed: gate.casesPassed,
    moneyCases: results.filter((one) => one.money).length,
    // A wrong answer on a money message; a call with no answer is counted in failedCalls.
    moneyFailures: replied.filter((one) => one.money && !one.passed).length,
    indicCases: indic.length,
    indicPassed: indic.filter((one) => one.passed).length,
    failedCalls: results.filter((one) => one.callFailed).length,
    p50Ms: median(answered),
    maxMs: answered.length === 0 ? 0 : Math.max(...answered),
    avgTokensIn: average(replied.map((one) => one.tokensIn)),
    avgTokensOut: average(replied.map((one) => one.tokensOut)),
    costPer1000Inr: costPerThousand(model, replied),
    priceNote: model.priceNote,
    passed: gate.passed,
    reasons: gate.reasons,
  };
}
