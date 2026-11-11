// supabase/functions/_shared/calls/cost.ts
// What a call cost, for the dashboard's calls page (SPEC §11/§12, M6 Decision 9). Live calls:
// Sarvam voice is ₹3.50 a minute + 18% GST, each call rounded up to a whole minute; a call that
// never connected costs nothing. Simulated calls: about ₹1 each in sarvam-105b tokens (M5
// Decision 6), shown as an estimate because token counts are not stored.
export const VOICE_INR_PER_MINUTE = 3.5;
export const GST = 0.18;
export const SIMULATED_ESTIMATE_INR = 1;

export interface CallCost {
  readonly inr: number;
  /** True when the figure is an estimate, not worked out from the call. */
  readonly estimate: boolean;
}

export function callCost(call: {
  mode: 'live' | 'simulated';
  durationSeconds: number | null;
}): CallCost {
  if (call.mode === 'simulated') return { inr: SIMULATED_ESTIMATE_INR, estimate: true };
  const minutes = Math.ceil((call.durationSeconds ?? 0) / 60);
  const inr = Math.round(minutes * VOICE_INR_PER_MINUTE * (1 + GST) * 100) / 100;
  return { inr, estimate: false };
}

/** The build's spend cap (CLAUDE.md budget guardrails); the ops page shows spend against it. */
export const SPEND_CAP_INR = 1000;

/** Sarvam's API reference price list for sarvam-105b, read 2026-11-11: ₹ per 1M tokens, before
 * GST. Sarvam's marketing page quoted a lower rate (₹4 / ₹16) on the same day; the higher,
 * documented one is used so spend is never understated. Gemini runs on the free tier. */
const TOKENS_PER_UNIT = 1_000_000;
export const LLM_INR_PER_MILLION: Readonly<
  Record<string, { readonly input: number; readonly output: number }>
> = {
  sarvam: { input: 29.28, output: 73.2 },
  gemini: { input: 0, output: 0 },
};

function toPaise(inr: number): number {
  return Math.round(inr * 100) / 100;
}

/** What `minutes` of live voice cost (each call already rounded up to whole minutes). */
export function voiceCost(minutes: number): number {
  return toPaise(minutes * VOICE_INR_PER_MINUTE * (1 + GST));
}

/** What a provider's tokens cost, with GST; an unknown provider is priced at nothing and the
 * caller shows its token counts as they are. */
export function llmCost(
  provider: string,
  tokens: { readonly input: number; readonly output: number },
): number {
  const price = LLM_INR_PER_MILLION[provider];
  if (!price) return 0;
  const beforeTax = (tokens.input * price.input + tokens.output * price.output) / TOKENS_PER_UNIT;
  return toPaise(beforeTax * (1 + GST));
}
