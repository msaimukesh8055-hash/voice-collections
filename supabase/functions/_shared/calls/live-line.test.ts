// supabase/functions/_shared/calls/live-line.test.ts
// The phone page's line (Live remind, 100%): idle, busy while a live call is on (but not for ever),
// a ringing call keeps ringing, otherwise the oldest queued call goes next, and a call that
// waited or rang too long is stale.
import { assertEquals } from '@std/assert';
import { fakeCall } from '../db/fake-repository.ts';
import type { CallSession } from '../db/repository.ts';
import { lineState } from './live-line.ts';
import { LIVE_CALL_MAX_MS, QUEUE_TIMEOUT_MS, RING_TIMEOUT_MS } from './ringing.ts';

const NOW = new Date('2026-11-02T06:30:00.000Z');
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

function call(id: string, overrides: Partial<CallSession>): CallSession {
  return fakeCall({ callId: `ca000000-0000-4000-8000-0000000000${id}`, ...overrides });
}

const queued = (id: string, msAgo: number): CallSession =>
  call(id, { status: 'queued', queuedAt: ago(msAgo), ringingAt: null, acceptedAt: null });

Deno.test('live line › nothing open → idle', () => {
  assertEquals(lineState([], NOW), { kind: 'idle' });
});

Deno.test('live line › an accepted or in-progress call holds the line; queued calls wait', () => {
  const waiting = queued('b1', 60_000);
  for (const status of ['accepted', 'in_progress'] as const) {
    const onCall = call('a1', { status, acceptedAt: ago(60_000) });
    assertEquals(lineState([waiting, onCall], NOW), { kind: 'busy' });
  }
});

Deno.test('live line › a call accepted over 5 minutes ago no longer holds the line', () => {
  const waiting = queued('b1', 60_000);
  const atLimit = call('a1', { status: 'in_progress', acceptedAt: ago(LIVE_CALL_MAX_MS) });
  const abandoned = call('a1', { status: 'in_progress', acceptedAt: ago(LIVE_CALL_MAX_MS + 1) });
  assertEquals(lineState([atLimit, waiting], NOW).kind, 'busy');
  assertEquals(lineState([abandoned, waiting], NOW), { kind: 'ring', call: waiting });
});

Deno.test('live line › with no accept time, the queue time counts', () => {
  const onCall = call('a1', { status: 'accepted', acceptedAt: null, queuedAt: ago(1000) });
  assertEquals(lineState([onCall], NOW).kind, 'busy');
});

Deno.test('live line › the oldest queued call rings first, whoever it is for', () => {
  const imran = { ...queued('b2', 10_000), shopkeeperId: '5e000000-0000-4000-8000-000000000007' };
  const later = queued('b3', 5_000);
  assertEquals(lineState([later, imran], NOW), { kind: 'ring', call: imran });
});

Deno.test('live line › a call already ringing keeps ringing ahead of older queued calls', () => {
  const older = queued('b1', 60_000);
  const ringing = call('b2', { status: 'ringing', queuedAt: ago(20_000), ringingAt: ago(5_000) });
  assertEquals(lineState([older, ringing], NOW), { kind: 'ring', call: ringing });
});

Deno.test('live line › a call that waited or rang too long is stale', () => {
  const waitedTooLong = queued('b1', QUEUE_TIMEOUT_MS + 1);
  const rangTooLong = call('b2', {
    status: 'ringing',
    queuedAt: ago(RING_TIMEOUT_MS + 5_000),
    ringingAt: ago(RING_TIMEOUT_MS + 1),
  });
  assertEquals(lineState([waitedTooLong], NOW), { kind: 'stale', call: waitedTooLong });
  assertEquals(lineState([rangTooLong], NOW), { kind: 'stale', call: rangTooLong });
});

Deno.test('live line › a call queued behind a full-length call can still ring after it', () => {
  assertEquals(QUEUE_TIMEOUT_MS > LIVE_CALL_MAX_MS, true);
  const behind = queued('b1', LIVE_CALL_MAX_MS + 30_000);
  assertEquals(lineState([behind], NOW).kind, 'ring');
});
