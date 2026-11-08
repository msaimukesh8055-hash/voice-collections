// supabase/functions/_shared/calls/call-history-owner.ts
// Munshi's lines for a shopkeeper's last Asha calls (M8 A5): the same structured history as Asha
// (call-history.ts, M7 B1: facts from the shop's records only, never the LLM-written note), worded
// for the owner. The shopkeeper's own words appear only inside the "Their words (a claim, not
// checked)" label. Capped at MAX_OWNER_HISTORY_CHARS: the oldest calls are dropped first.
import { formatRupees, formatShortDay } from '../format.ts';
import type { CallbackReason } from '../followup/facts.ts';
import type { Outcome } from '../followup/rules.ts';
import type { CallHistory, PastCall, PastClaim, PastPromise } from './call-history.ts';

export const MAX_OWNER_HISTORY_CHARS = 400;

const HEADER = "Asha's calls (from the shop's records, newest first):";
const ASKED_FOR_YOU = 'asked you to call back';
const NOTHING_AGREED = 'spoke; nothing was agreed';

/** Outcomes whose line is fixed: nothing else from the call is said. */
const FIXED_OUTCOME_TEXT: Readonly<Partial<Record<Outcome, string>>> = {
  declined: 'he declined the call',
  no_answer: 'no answer',
  wrong_person: 'someone else answered; nothing was shared',
  ended_early: 'the call ended before he confirmed who he was',
};

const PROMISE_RESULT: Readonly<Record<PastPromise['status'], (promise: PastPromise) => string>> = {
  kept: () => 'kept',
  open: () => 'still open',
  broken: (promise) => `broken, ${formatRupees(promise.paid)} of it paid`,
  replaced: () => 'replaced by a later promise',
};

const CLAIM_RESULT: Readonly<Record<PastClaim['status'], string>> = {
  confirmed: 'you confirmed it',
  rejected: 'you marked it not received',
  claimed: 'waiting for you to confirm',
  reversed: 'you later deleted it',
};

const REASON_TEXT: Readonly<Record<CallbackReason, string>> = {
  hardship: 'said money is tight',
  dispute: 'disputed the amount',
  wants_owner: ASKED_FOR_YOU,
  other: ASKED_FOR_YOU,
};

function promisePart(promise: PastPromise): string {
  return `promised ${formatRupees(promise.amount)} by ${formatShortDay(promise.promiseDate)}, ` +
    PROMISE_RESULT[promise.status](promise);
}

function claimPart(claim: PastClaim): string {
  const mode = claim.mode === null ? '' : ` by ${claim.mode.replace('_', ' ')}`;
  return `said ${formatRupees(claim.amount)} was paid on ${formatShortDay(claim.paidDate)}` +
    `${mode}, ${CLAIM_RESULT[claim.status]}`;
}

function factParts(call: PastCall): readonly string[] {
  const parts = [
    call.claim ? claimPart(call.claim) : null,
    call.promise ? promisePart(call.promise) : null,
    ...new Set(call.reasons.map((reason) => REASON_TEXT[reason])),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts : [NOTHING_AGREED];
}

function outcomeParts(call: PastCall): readonly string[] {
  const fixed = FIXED_OUTCOME_TEXT[call.outcome];
  if (fixed) return [fixed];
  // Before identity the speaker may not be him: only that the owner was asked to call.
  if (!call.identityConfirmed) return [ASKED_FOR_YOU];
  const extras = [
    call.upset ? 'was upset about the calls' : null,
    call.theirWords === null ? null : `Their words (a claim, not checked): "${call.theirWords}"`,
  ].filter((part): part is string => part !== null);
  return [...factParts(call), ...extras];
}

function callLine(call: PastCall): string {
  const kind = call.mode === 'simulated' ? ' (text call)' : '';
  return `${formatShortDay(call.date)}${kind}: ${outcomeParts(call).join('; ')}.`;
}

/** Plain facts for Munshi's lookup reply; '' when Asha has not called him (nothing to say). */
export function describeHistoryForOwner(history: CallHistory): string {
  let said = HEADER;
  let shown = 0;
  for (const call of history) {
    const next = `${said} ${callLine(call)}`;
    if (next.length > MAX_OWNER_HISTORY_CHARS) break;
    said = next;
    shown += 1;
  }
  return shown === 0 ? '' : said;
}
