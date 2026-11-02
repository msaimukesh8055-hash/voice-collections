// supabase/functions/_shared/calls/ringing.test.ts
import { assertEquals } from '@std/assert';
import { fakeCall } from '../db/fake-repository.ts';
import { isStillRinging, QUEUE_TIMEOUT_MS, RING_TIMEOUT_MS } from './ringing.ts';

const QUEUED_AT = '2026-11-02T06:30:00.000Z';
const at = (ms: number): Date => new Date(Date.parse(QUEUED_AT) + ms);

Deno.test('ringing › a queued call waits for the phone page up to the queue timeout', () => {
  const call = fakeCall({ status: 'queued', queuedAt: QUEUED_AT, ringingAt: null });
  assertEquals(isStillRinging(call, at(QUEUE_TIMEOUT_MS)), true);
  assertEquals(isStillRinging(call, at(QUEUE_TIMEOUT_MS + 1)), false);
});

Deno.test('ringing › a ringing call rings for 30 seconds from when it started ringing', () => {
  const call = fakeCall({
    status: 'ringing',
    queuedAt: QUEUED_AT,
    ringingAt: at(5_000).toISOString(),
  });
  assertEquals(RING_TIMEOUT_MS, 30_000);
  assertEquals(isStillRinging(call, at(5_000 + RING_TIMEOUT_MS)), true);
  assertEquals(isStillRinging(call, at(5_001 + RING_TIMEOUT_MS)), false);
});

Deno.test('ringing › a ringing call with no ring time counts from when it was queued', () => {
  const call = fakeCall({ status: 'ringing', queuedAt: QUEUED_AT, ringingAt: null });
  assertEquals(isStillRinging(call, at(RING_TIMEOUT_MS + 1)), false);
});

Deno.test('ringing › any other status is not ringing', () => {
  assertEquals(isStillRinging(fakeCall({ status: 'accepted' }), at(0)), false);
});
