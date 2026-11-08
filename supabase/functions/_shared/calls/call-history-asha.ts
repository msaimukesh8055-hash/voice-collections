// supabase/functions/_shared/calls/call-history-asha.ts
// Asha's lines for earlier calls (M7 B1 Decision 2): the structured history from
// call-history.ts turned into plain English facts for get_dues's `say` (Sarvam passes only `say`
// to the LLM). Figures are formatted like the rest of get_dues. The shopkeeper's own words appear
// only inside the "Their words (a claim, not checked)" label; how to use them is in her prompt.
// Capped at MAX_HISTORY_CHARS so Asha does not slow down: the oldest calls are dropped first.
import { formatDay, formatRupees } from '../format.ts';
import type { CallbackReason } from '../followup/facts.ts';
import type { Outcome } from '../followup/rules.ts';
import type { ToolData } from '../tools/types.ts';
import type { CallHistory, PastCall, PastClaim, PastPromise } from './call-history.ts';

export const MAX_HISTORY_CHARS = 600;

const HEADER = "Earlier calls (from the shop's records, newest first):";
const ASKED_FOR_OWNER = 'asked for the owner to call back';
const NOTHING_AGREED = 'spoke; nothing was agreed';

/** Outcomes whose line is fixed: nothing else from the call is shared. */
const FIXED_OUTCOME_TEXT: Readonly<Partial<Record<Outcome, string>>> = {
  declined: 'declined the call',
  no_answer: 'did not answer',
  wrong_person: 'someone else answered; nothing was shared',
  ended_early: 'the call ended before identity was confirmed',
};

const PROMISE_RESULT: Readonly<Record<PastPromise['status'], (promise: PastPromise) => string>> = {
  kept: () => 'kept',
  open: () => 'still open',
  broken: (promise) => `broken, ${formatRupees(promise.paid)} of it paid`,
  replaced: () => 'replaced by a later promise',
};

const CLAIM_RESULT: Readonly<Record<PastClaim['status'], string>> = {
  confirmed: 'the owner confirmed it',
  rejected: 'the owner did not receive it',
  claimed: 'not yet confirmed',
  reversed: 'the owner later deleted it',
};

const REASON_TEXT: Readonly<Record<CallbackReason, string>> = {
  hardship: 'said money is tight (hardship)',
  dispute: 'disputed the amount',
  wants_owner: ASKED_FOR_OWNER,
  other: ASKED_FOR_OWNER,
};

function promisePart(promise: PastPromise): string {
  return `promised ${formatRupees(promise.amount)} by ${formatDay(promise.promiseDate)}; ` +
    PROMISE_RESULT[promise.status](promise);
}

function claimPart(claim: PastClaim): string {
  const mode = claim.mode === null ? '' : ` (${claim.mode.replace('_', ' ')})`;
  return `said ${formatRupees(claim.amount)} was paid on ${formatDay(claim.paidDate)}${mode}; ` +
    CLAIM_RESULT[claim.status];
}

/** What a confirmed call left behind: claim, promise, then each reason phrase once. */
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
  if (!call.identityConfirmed) return [ASKED_FOR_OWNER];
  const extras = [
    call.upset ? 'was upset about the calls' : null,
    call.theirWords === null ? null : `Their words (a claim, not checked): "${call.theirWords}"`,
  ].filter((part): part is string => part !== null);
  return [...factParts(call), ...extras];
}

function callLine(call: PastCall, index: number): string {
  return `${index + 1}) ${formatDay(call.date)}: ${outcomeParts(call).join('. ')}.`;
}

/** The newest calls whose lines fit in MAX_HISTORY_CHARS with the header. */
function callsThatFit(history: CallHistory): CallHistory {
  const kept: PastCall[] = [];
  let length = HEADER.length;
  for (const [index, call] of history.entries()) {
    length += 1 + callLine(call, index).length;
    if (length > MAX_HISTORY_CHARS) break;
    kept.push(call);
  }
  return kept;
}

/** Plain facts for Asha's tool reply; '' when there is no history (she then says nothing). */
export function describeHistoryForAsha(history: CallHistory): string {
  const shown = callsThatFit(history);
  if (shown.length === 0) return '';
  return [HEADER, ...shown.map(callLine)].join(' ');
}

/** For the audit row: counts only, never the shopkeeper's words. */
export function historyData(history: CallHistory): ToolData {
  const shown = callsThatFit(history);
  return {
    past_calls: shown.length,
    their_words_shown: shown.filter((call) => call.theirWords !== null).length,
  };
}
