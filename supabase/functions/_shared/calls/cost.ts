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
