// supabase/functions/_shared/calls/ringing.ts
// How long a call waits for the phone page, and how long it rings (SPEC §7.1: no answer in
// 30 s → missed). Measured on real time: database timestamps are real time, not the demo clock.
import type { CallSession } from '../db/repository.ts';

export const RING_TIMEOUT_MS = 30_000;
/** A queued call nobody's phone page picked up within this is dropped as missed. */
export const QUEUE_TIMEOUT_MS = 120_000;

function elapsedSince(iso: string, realNow: Date): number {
  return realNow.getTime() - Date.parse(iso);
}

export function isStillRinging(call: CallSession, realNow: Date): boolean {
  if (call.status === 'queued') return elapsedSince(call.queuedAt, realNow) <= QUEUE_TIMEOUT_MS;
  if (call.status !== 'ringing') return false;
  return elapsedSince(call.ringingAt ?? call.queuedAt, realNow) <= RING_TIMEOUT_MS;
}
