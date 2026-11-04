// supabase/functions/_shared/calls/memory.ts
// What Asha remembers about a shopkeeper (SPEC §7.3, M5 Decision 2): the last promise (amount,
// date, kept / broken / open, and what was paid towards it) and a payment claim the owner marked
// "not received" in the last 30 days. get_dues adds this to its reply only after identity is
// confirmed. Every line is built in code from the ledger and promise records.
// The follow-up note is NOT part of it (CP2 M2): the LLM writes it from the shopkeeper's own
// words, so planted claims ("the owner agreed to waive ₹2,000") could come back to Asha as
// trusted tool output. The note stays stored for the owner and the dashboard; cleanNote below
// keeps it to one short line.
import { addDays } from '../clock.ts';
import { formatDay, formatRupees } from '../format.ts';
import { paidTowards, type PromiseRecord } from '../ledger/promise-check.ts';
import type { LedgerEntry } from '../schemas/ledger.ts';
import type { ToolData } from '../tools/types.ts';

export const MAX_NOTE_LENGTH = 240;
export const REJECTED_CLAIM_DAYS = 30;

export interface RememberedPromise {
  readonly amount: number;
  readonly promiseDate: string;
  readonly status: 'open' | 'kept' | 'broken';
  readonly paid: number;
}

export interface RejectedClaim {
  readonly amount: number;
  readonly paidDate: string;
}

export interface Memory {
  readonly lastPromise: RememberedPromise | null;
  readonly rejectedClaim: RejectedClaim | null;
}

export interface MemoryInputs {
  /** The shopkeeper's promises, after today's promise check. */
  readonly promises: readonly PromiseRecord[];
  readonly entries: readonly LedgerEntry[];
  readonly today: string;
}

export const EMPTY_MEMORY: Memory = { lastPromise: null, rejectedClaim: null };

type JudgeablePromise = PromiseRecord & { readonly status: RememberedPromise['status'] };

function isJudgeable(promise: PromiseRecord): promise is JudgeablePromise {
  return promise.status !== 'replaced';
}

function lastPromiseOf(
  promises: readonly PromiseRecord[],
  entries: readonly LedgerEntry[],
): RememberedPromise | null {
  const newest = promises
    .filter(isJudgeable)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!newest) return null;
  return {
    amount: newest.amount,
    promiseDate: newest.promiseDate,
    status: newest.status,
    paid: paidTowards(newest, entries),
  };
}

/** One line, capped: the stored follow-up note never grows past one short line. */
export function toNoteLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_LENGTH);
}

/** The cleaned note, or null when nothing is left. */
export function cleanNote(note: string | null): string | null {
  const line = toNoteLine(note ?? '');
  return line === '' ? null : line;
}

function rejectedClaimOf(entries: readonly LedgerEntry[], today: string): RejectedClaim | null {
  const since = addDays(today, -REJECTED_CLAIM_DAYS);
  const newest = entries
    .filter((entry) => entry.kind === 'payment' && entry.status === 'rejected')
    .filter((entry) => entry.entryDate >= since)
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate))[0];
  return newest ? { amount: newest.amount, paidDate: newest.entryDate } : null;
}

export function buildMemory(inputs: MemoryInputs): Memory {
  return {
    lastPromise: lastPromiseOf(inputs.promises, inputs.entries),
    rejectedClaim: rejectedClaimOf(inputs.entries, inputs.today),
  };
}

const PROMISE_STATUS_TEXT: Readonly<
  Record<RememberedPromise['status'], (promise: RememberedPromise) => string>
> = {
  kept: () => 'Kept.',
  open: () => 'Still open.',
  broken: (promise) => `Broken: ${formatRupees(promise.paid)} of it was paid.`,
};

function promiseLine(promise: RememberedPromise): string {
  return `Last promise: ${formatRupees(promise.amount)} by ${formatDay(promise.promiseDate)}. ` +
    PROMISE_STATUS_TEXT[promise.status](promise);
}

function rejectedClaimLine(claim: RejectedClaim): string {
  return `The owner did not receive a payment of ${formatRupees(claim.amount)} they said was ` +
    `made on ${formatDay(claim.paidDate)}.`;
}

/** Plain facts for Asha's tool reply; '' when nothing is known (she then says nothing). */
export function describeMemory(memory: Memory): string {
  const { lastPromise, rejectedClaim } = memory;
  return [
    lastPromise ? promiseLine(lastPromise) : null,
    rejectedClaim ? rejectedClaimLine(rejectedClaim) : null,
  ].filter((line): line is string => line !== null).join(' ');
}

export function memoryData(memory: Memory): ToolData {
  const { lastPromise, rejectedClaim } = memory;
  return {
    last_promise_amount: lastPromise?.amount ?? null,
    last_promise_date: lastPromise?.promiseDate ?? null,
    last_promise_status: lastPromise?.status ?? null,
    last_promise_paid: lastPromise?.paid ?? null,
    rejected_claim_amount: rejectedClaim?.amount ?? null,
    rejected_claim_date: rejectedClaim?.paidDate ?? null,
  };
}
