// supabase/functions/_shared/calls/ringing.ts
// How long a call waits for the phone page, and how long it rings (SPEC §7.1: no answer in
// 30 s → missed). Measured on real time: database timestamps are real time, not the demo clock.
import type { CallSession } from '../db/repository.ts';

export const RING_TIMEOUT_MS = 30_000;
/** Sarvam ends every call at 4 minutes (voice-agents/schema.ts); one more minute covers
 * connecting. A live call accepted longer ago than this no longer holds the phone page. */
export const LIVE_CALL_MAX_MS = 5 * 60_000;
/** M8: Sarvam ends every Munshi call at 8 minutes; one more minute covers connecting. An owner
 * call accepted longer ago than this no longer holds the phone page's line. */
export const OWNER_CALL_MAX_MS = 9 * 60_000;
/** A queued call nobody's phone page picked up within this is dropped as missed. Long enough
 * for a call queued behind a full-length live call to still ring after it (Live remind), and,
 * since M8, for a Remind asked for early in an 8-minute Munshi call to ring after it ends. */
export const QUEUE_TIMEOUT_MS = OWNER_CALL_MAX_MS + 120_000;

function elapsedSince(iso: string, realNow: Date): number {
  return realNow.getTime() - Date.parse(iso);
}

export function isStillRinging(call: CallSession, realNow: Date): boolean {
  if (call.status === 'queued') return elapsedSince(call.queuedAt, realNow) <= QUEUE_TIMEOUT_MS;
  if (call.status !== 'ringing') return false;
  return elapsedSince(call.ringingAt ?? call.queuedAt, realNow) <= RING_TIMEOUT_MS;
}
