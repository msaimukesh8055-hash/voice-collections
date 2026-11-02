// supabase/functions/_shared/compliance/promise-policy.ts
// Promise and payment-claim rules (M3 Decision 9). Part payments are normal udhaar, so any amount
// from ₹100 to the full outstanding is fine. Refusal reasons are worded so Asha can say them and
// agree new terms instead of guessing.
import { addDays } from '../clock.ts';
import { formatDay, formatRupees } from '../format.ts';

export const MIN_PROMISE_AMOUNT = 100;
export const PROMISE_WINDOW_DAYS = 14;
export const CLAIM_WINDOW_DAYS = 30;

export type PolicyResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface PromiseInput {
  readonly amount: number;
  /** YYYY-MM-DD */
  readonly promiseDate: string;
  readonly outstanding: number;
  /** India date (YYYY-MM-DD) from the demo-aware clock. */
  readonly today: string;
}

export interface ClaimInput {
  readonly amount: number;
  /** YYYY-MM-DD */
  readonly paidDate: string;
  readonly outstanding: number;
  readonly today: string;
}

const ACCEPTED: PolicyResult = { ok: true };

function refuse(reason: string): PolicyResult {
  return { ok: false, reason };
}

export function checkPromise(input: PromiseInput): PolicyResult {
  if (input.outstanding <= 0) {
    return refuse('Nothing is outstanding, so there is no promise to take.');
  }
  const lastDate = addDays(input.today, PROMISE_WINDOW_DAYS);
  // ISO dates compare correctly as strings.
  if (input.promiseDate < input.today || input.promiseDate > lastDate) {
    return refuse(
      `The promise date must be between ${formatDay(input.today)} and ${formatDay(lastDate)}. ` +
        'Ask for a date in that range.',
    );
  }
  if (input.amount < MIN_PROMISE_AMOUNT || input.amount > input.outstanding) {
    const range = `${formatRupees(MIN_PROMISE_AMOUNT)} and ${formatRupees(input.outstanding)}`;
    return refuse(`The promised amount must be between ${range}. Ask for an amount in that range.`);
  }
  return ACCEPTED;
}

export function checkPaymentClaim(input: ClaimInput): PolicyResult {
  if (input.outstanding <= 0) {
    return refuse('Nothing is outstanding. Say the owner will check his book; record nothing.');
  }
  if (input.amount > input.outstanding) {
    return refuse(
      `The amount cannot be more than the outstanding ${formatRupees(input.outstanding)}. ` +
        'Ask them to check the amount.',
    );
  }
  if (input.paidDate > input.today) {
    return refuse('The payment date cannot be in the future. Ask when they actually paid.');
  }
  if (input.paidDate < addDays(input.today, -CLAIM_WINDOW_DAYS)) {
    return refuse(
      `Only payments made in the last ${CLAIM_WINDOW_DAYS} days can be recorded on a call. ` +
        'Offer an owner callback instead.',
    );
  }
  return ACCEPTED;
}
