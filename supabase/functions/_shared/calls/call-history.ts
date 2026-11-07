// supabase/functions/_shared/calls/call-history.ts
// What happened on a shopkeeper's last calls (M7 B1 Decision 2): rows in, structured facts out.
// Pure and language-free, so Asha's describer (call-history-asha.ts) and later Munshi's owner
// describer (ADR-0018) share one source of truth. Every fact comes from the shop's own records:
// call status and identity, the promise and claim saved on the call, Asha's callback rows (fixed
// reason list) and the follow-up run's fixed signal list. The LLM-written follow-up note and the
// follow-up agent's free-text reasoning are never read (CP2 M2). The only words from the
// shopkeeper are one sanitised phrase per call (their-words.ts).
import { istDate } from '../clock.ts';
import type { CallMode } from '../db/repository.ts';
import type { CallbackReason } from '../followup/facts.ts';
import { type MixedSignal, type Outcome, outcomeFrom } from '../followup/rules.ts';
import { isWithinHistory } from '../ledger/history.ts';
import { paidTowards, type PromiseRecord } from '../ledger/promise-check.ts';
import type {
  LEDGER_STATUSES,
  LedgerEntry,
  PaymentMode,
  PromiseStatus,
} from '../schemas/ledger.ts';
import type { IdentityStatus } from '../schemas/shopkeeper.ts';
import { CALLBACK_REASONS } from '../tools/schemas.ts';
import { theirWords } from './their-words.ts';

export const MAX_PAST_CALLS = 3;

/** Statuses of a call that has ended: only these can be history. */
export const ENDED_CALL_STATUSES = ['completed', 'declined', 'missed'] as const;
export type EndedCallStatus = (typeof ENDED_CALL_STATUSES)[number];

export interface PastClaim {
  readonly amount: number;
  readonly paidDate: string;
  readonly mode: PaymentMode | null;
  readonly status: (typeof LEDGER_STATUSES)[number];
}

/** A followups row linked to the call, as stored. Asha's callback tool writes kind
 * owner_callback with a fixed reason and her summary; the worker's rows have no summary. */
export interface PastFollowup {
  readonly kind: string;
  readonly reason: string;
  readonly summary: string | null;
}

/** One earlier call with its linked rows, as read from the database (no logic). */
export interface PastCallRow {
  readonly id: string;
  readonly queuedAt: string;
  readonly mode: CallMode;
  readonly status: EndedCallStatus;
  readonly identityStatus: IdentityStatus;
  readonly promises: readonly PromiseRecord[];
  readonly claims: readonly PastClaim[];
  readonly followups: readonly PastFollowup[];
  readonly signals: readonly MixedSignal[];
}

export interface PastPromise {
  readonly amount: number;
  readonly promiseDate: string;
  readonly status: PromiseStatus;
  /** Confirmed rupees paid inside the promise window. */
  readonly paid: number;
}

export interface PastCall {
  /** India date of the call, never after today on the demo clock. */
  readonly date: string;
  readonly mode: CallMode;
  readonly outcome: Outcome;
  readonly identityConfirmed: boolean;
  readonly promise: PastPromise | null;
  readonly claim: PastClaim | null;
  readonly reasons: readonly CallbackReason[];
  readonly upset: boolean;
  readonly theirWords: string | null;
}

/** Newest first, at most MAX_PAST_CALLS. */
export type CallHistory = readonly PastCall[];

export interface CallHistoryInputs {
  readonly rows: readonly PastCallRow[];
  /** The shopkeeper's promises after today's promise check. */
  readonly promises: readonly PromiseRecord[];
  readonly entries: readonly LedgerEntry[];
  /** India date on the demo clock. */
  readonly today: string;
  readonly currentCallId: string;
}

interface Callback {
  readonly reason: CallbackReason;
  readonly summary: string;
}

function isCallbackReason(reason: string): reason is CallbackReason {
  return (CALLBACK_REASONS as readonly string[]).includes(reason);
}

/** Only rows written by Asha's request_owner_callback tool. */
function callbacksOf(row: PastCallRow): readonly Callback[] {
  return row.followups.flatMap((followup): Callback[] => {
    const { kind, reason, summary } = followup;
    const isAshas = kind === 'owner_callback' && summary !== null && isCallbackReason(reason);
    return isAshas ? [{ reason, summary }] : [];
  });
}

function promiseOf(row: PastCallRow, inputs: CallHistoryInputs): PastPromise | null {
  const stored = row.promises[0];
  if (!stored) return null;
  const checked = inputs.promises.find((promise) => promise.id === stored.id) ?? stored;
  return {
    amount: stored.amount,
    promiseDate: stored.promiseDate,
    status: checked.status,
    paid: paidTowards(stored, inputs.entries),
  };
}

function firstPhrase(callbacks: readonly Callback[], identityConfirmed: boolean): string | null {
  for (const callback of callbacks) {
    const phrase = theirWords(callback.summary, { reason: callback.reason, identityConfirmed });
    if (phrase !== null) return phrase;
  }
  return null;
}

function callDate(row: PastCallRow, today: string): string {
  const date = istDate(new Date(row.queuedAt));
  return date > today ? today : date;
}

function toPastCall(row: PastCallRow, inputs: CallHistoryInputs): PastCall {
  const callbacks = callbacksOf(row);
  const identityConfirmed = row.identityStatus === 'confirmed';
  const promise = promiseOf(row, inputs);
  const claim = row.claims[0] ?? null;
  const outcome = outcomeFrom({
    connected: row.status === 'completed',
    declined: row.status === 'declined',
    identity: row.identityStatus,
    hasClaim: claim !== null,
    hasPromise: promise !== null,
    callbackCount: callbacks.length,
  });
  return {
    date: callDate(row, inputs.today),
    mode: row.mode,
    outcome,
    identityConfirmed,
    promise,
    claim,
    reasons: [...new Set(callbacks.map((callback) => callback.reason))],
    upset: row.signals.includes('angry'),
    theirWords: firstPhrase(callbacks, identityConfirmed),
  };
}

export function buildCallHistory(inputs: CallHistoryInputs): CallHistory {
  return [...inputs.rows]
    .filter((row) => row.id !== inputs.currentCallId)
    .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))
    .map((row) => toPastCall(row, inputs))
    .filter((call) => isWithinHistory(call.date, inputs.today))
    .slice(0, MAX_PAST_CALLS);
}
