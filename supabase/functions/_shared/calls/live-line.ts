// supabase/functions/_shared/calls/live-line.ts
// The phone page's line (Live remind, pre-M6): any shopkeeper can get a live call, but there is
// one phone page, so live calls ring one at a time, oldest first. While one is accepted or in
// progress the line is busy and the rest wait as 'queued'; nothing waiting is marked missed.
import type { CallSession } from '../db/repository.ts';
import { isStillRinging, LIVE_CALL_MAX_MS } from './ringing.ts';

export type LineState =
  /** No live call is waiting. */
  | { readonly kind: 'idle' }
  /** A live call is on the phone page; the next one rings after it ends. */
  | { readonly kind: 'busy' }
  /** This call should ring now. */
  | { readonly kind: 'ring'; readonly call: CallSession }
  /** This call waited or rang too long: mark it missed. */
  | { readonly kind: 'stale'; readonly call: CallSession };

/** A live call holds the line from accept until it ends, at most LIVE_CALL_MAX_MS (a page closed
 * mid-call never reports the end, so it can't block the line for ever). */
function holdsLine(call: CallSession, realNow: Date): boolean {
  if (call.status !== 'accepted' && call.status !== 'in_progress') return false;
  const since = Date.parse(call.acceptedAt ?? call.queuedAt);
  return realNow.getTime() - since <= LIVE_CALL_MAX_MS;
}

function byQueuedAt(a: CallSession, b: CallSession): number {
  return a.queuedAt.localeCompare(b.queuedAt);
}

/** `calls`: the open live calls (queued, ringing, accepted, in progress), in any order.
 * `ownerCallActive` (M8): Munshi is on a call with the owner (accepted within OWNER_CALL_MAX_MS),
 * so the line is busy and a Remind he asked for rings after he hangs up. */
export function lineState(
  calls: readonly CallSession[],
  realNow: Date,
  ownerCallActive = false,
): LineState {
  if (ownerCallActive || calls.some((call) => holdsLine(call, realNow))) return { kind: 'busy' };
  const waiting = calls.filter((call) => call.status === 'queued' || call.status === 'ringing');
  // A call already ringing keeps ringing; otherwise the oldest queued call goes next.
  const next = waiting.find((call) => call.status === 'ringing') ??
    [...waiting].sort(byQueuedAt)[0];
  if (!next) return { kind: 'idle' };
  return isStillRinging(next, realNow)
    ? { kind: 'ring', call: next }
    : { kind: 'stale', call: next };
}
