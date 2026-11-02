// supabase/functions/_shared/compliance/promise-policy.ts
// Promise-to-pay and payment-link rules (M2 Decision 3). Refusal reasons are worded so Asha can
// say them and renegotiate instead of guessing.
import { addDays } from '../clock.ts';

export const PROMISE_WINDOW_DAYS = 10;
export const MIN_PROMISE_SHARE = 0.5;
export const PAYMENT_MODES = ['upi', 'net_banking', 'debit_card', 'branch'] as const;

export type PolicyResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface PromiseInput {
  readonly amount: number;
  /** YYYY-MM-DD */
  readonly promiseDate: string;
  readonly overdueAmount: number;
  /** India date (YYYY-MM-DD) from the demo-aware clock. */
  readonly today: string;
}

const RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function refuse(reason: string): PolicyResult {
  return { ok: false, reason };
}

export function checkPromise(input: PromiseInput): PolicyResult {
  if (input.overdueAmount <= 0) return refuse('There is no overdue amount on this loan.');
  const lastDate = addDays(input.today, PROMISE_WINDOW_DAYS);
  // ISO dates compare correctly as strings.
  if (input.promiseDate < input.today || input.promiseDate > lastDate) {
    return refuse(`The promise date must be between ${input.today} and ${lastDate}.`);
  }
  const minAmount = Math.ceil(input.overdueAmount * MIN_PROMISE_SHARE);
  if (input.amount < minAmount || input.amount > input.overdueAmount) {
    const range = `${RUPEES.format(minAmount)} and ${RUPEES.format(input.overdueAmount)}`;
    return refuse(`The promised amount must be between ${range}.`);
  }
  return { ok: true };
}

export function checkPaymentLinkAmount(amount: number, overdueAmount: number): PolicyResult {
  if (amount > overdueAmount) {
    return refuse(
      `A payment link can be at most the overdue amount, ${RUPEES.format(overdueAmount)}.`,
    );
  }
  return { ok: true };
}
