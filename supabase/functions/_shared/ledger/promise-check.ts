// supabase/functions/_shared/ledger/promise-check.ts
// Promise checker (M5 Decision 3 (a), SPEC §8.6). A promise is **kept** when confirmed payments
// made between the day it was given (India date) and its date + 1 grace day add up to the
// promised amount; it is **broken** from the day after the grace day; until then it stays open.
// A part payment still breaks it (the summary says "paid X of Y"). Only open promises change,
// and the date passed in is the demo-clock "today", so running the check twice changes nothing
// and moving the demo clock forward shows a promise break.
import { addDays, istDate } from '../clock.ts';
import type { LedgerEntry, PromiseStatus } from '../schemas/ledger.ts';
import { toPaise, toRupees } from './dues.ts';

export const PROMISE_GRACE_DAYS = 1;

export interface PromiseRecord {
  readonly id: string;
  readonly amount: number;
  readonly promiseDate: string;
  readonly status: PromiseStatus;
  /** When the promise was saved (ISO timestamp). */
  readonly createdAt: string;
}

export type PromiseTerms = Pick<PromiseRecord, 'amount' | 'promiseDate' | 'createdAt'>;

export interface PromiseVerdict {
  readonly status: 'open' | 'kept' | 'broken';
  /** Confirmed rupees paid inside the promise window. */
  readonly paid: number;
}

export interface PromiseChange {
  readonly id: string;
  readonly status: 'kept' | 'broken';
  readonly paid: number;
  readonly amount: number;
}

function lastCountingDay(promise: PromiseTerms): string {
  return addDays(promise.promiseDate, PROMISE_GRACE_DAYS);
}

/** Confirmed payments made from the promise's India day to its date + grace. */
export function paidTowards(promise: PromiseTerms, entries: readonly LedgerEntry[]): number {
  const from = istDate(new Date(promise.createdAt));
  const to = lastCountingDay(promise);
  const paise = entries
    .filter((entry) => entry.kind === 'payment' && entry.status === 'confirmed')
    .filter((entry) => entry.entryDate >= from && entry.entryDate <= to)
    .reduce((sum, entry) => sum + toPaise(entry.amount), 0);
  return toRupees(paise);
}

export function judgePromise(
  promise: PromiseTerms,
  entries: readonly LedgerEntry[],
  today: string,
): PromiseVerdict {
  const paid = paidTowards(promise, entries);
  if (toPaise(paid) >= toPaise(promise.amount)) return { status: 'kept', paid };
  // ISO dates compare correctly as strings.
  if (today > lastCountingDay(promise)) return { status: 'broken', paid };
  return { status: 'open', paid };
}

/** The open promises whose status changes today; everything else is left alone. */
export function checkPromises(
  promises: readonly PromiseRecord[],
  entries: readonly LedgerEntry[],
  today: string,
): readonly PromiseChange[] {
  return promises
    .filter((promise) => promise.status === 'open')
    .flatMap((promise): PromiseChange[] => {
      const verdict = judgePromise(promise, entries, today);
      if (verdict.status === 'open') return [];
      return [{
        id: promise.id,
        status: verdict.status,
        paid: verdict.paid,
        amount: promise.amount,
      }];
    });
}

/** The promise list with today's changes applied (for memory and tone right after a check). */
export function applyPromiseChanges<P extends PromiseRecord>(
  promises: readonly P[],
  changes: readonly PromiseChange[],
): readonly P[] {
  const byId = new Map(changes.map((change) => [change.id, change.status]));
  return promises.map((promise) => {
    const status = byId.get(promise.id);
    return status ? { ...promise, status } : promise;
  });
}
