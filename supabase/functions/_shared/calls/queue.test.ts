// supabase/functions/_shared/calls/queue.test.ts
// The reminder queue (M5 test list, 100%): the live shopkeeper rings, others are simulated, the
// pre-call check applies to every person, and the 4-at-once limit for simulated calls holds.
import { assertEquals } from '@std/assert';
import { createFakeReminderRepository } from '../db/fake-reminder-repository.ts';
import type { DemoSettings } from '../db/repository.ts';
import {
  MAX_SIMULATED_AT_ONCE,
  type QueueDeps,
  queueReminders,
  type QueueTarget,
  SIMULATION_STALE_MS,
  simulationStaleBefore,
} from './queue.ts';

const LIVE = '5e000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-02T06:30:00.000Z'); // 12:00 IST
const NIGHT = new Date('2026-11-02T16:30:00.000Z'); // 22:00 IST

function target(n: number, doNotCall = false): QueueTarget {
  return { shopkeeperId: `5e000000-0000-4000-8000-00000000000${n}`, language: 'te', doNotCall };
}

function settings(overrides: Partial<DemoSettings> = {}): DemoSettings {
  return {
    demoClock: null,
    callingHoursEnabled: false,
    callLimitsEnabled: false,
    liveShopkeeperId: LIVE,
    ...overrides,
  };
}

function deps(
  overrides: Partial<DemoSettings> = {},
  clock = NOW,
): { fake: ReturnType<typeof createFakeReminderRepository>; deps: QueueDeps } {
  const fake = createFakeReminderRepository({ clock: () => clock });
  return {
    fake,
    deps: {
      repo: { getDemoSettings: () => Promise.resolve(settings(overrides)) },
      store: fake.reminders,
      clock: () => clock,
    },
  };
}

Deno.test('queue › the live shopkeeper rings; everyone else is queued as simulated', async () => {
  const { deps: d, fake } = deps();
  const batch = await queueReminders(d, [target(1), target(2), target(3)]);
  assertEquals(batch.live?.shopkeeperId, LIVE);
  assertEquals(batch.simulated.map((c) => c.shopkeeperId), [
    target(2).shopkeeperId,
    target(3).shopkeeperId,
  ]);
  assertEquals(fake.state.calls.map((c) => [c.mode, c.status]), [
    ['live', 'queued'],
    ['simulated', 'queued'],
    ['simulated', 'queued'],
  ]);
  assertEquals(batch.blocked, []);
});

Deno.test('queue › do-not-call is never queued (pre-call check)', async () => {
  const { deps: d, fake } = deps();
  const batch = await queueReminders(d, [target(2, true), target(3)]);
  assertEquals(batch.blocked, [{ shopkeeperId: target(2).shopkeeperId, code: 'DO_NOT_CALL' }]);
  assertEquals(fake.state.calls.length, 1);
});

Deno.test('queue › calling hours, when switched on, block the whole batch at night', async () => {
  const { deps: d, fake } = deps({ callingHoursEnabled: true }, NIGHT);
  const batch = await queueReminders(d, [target(1), target(2)]);
  assertEquals(batch.blocked.map((b) => b.code), [
    'OUTSIDE_CALLING_HOURS',
    'OUTSIDE_CALLING_HOURS',
  ]);
  assertEquals([batch.live, fake.state.calls.length], [null, 0]);
});

Deno.test('queue › the demo clock decides calling hours', async () => {
  const { deps: d } = deps({ callingHoursEnabled: true, demoClock: NOW.toISOString() }, NIGHT);
  const batch = await queueReminders(d, [target(2)]);
  assertEquals(batch.simulated.length, 1);
});

Deno.test('queue › attempt limits, when switched on, count earlier calls today and this week', async () => {
  const { deps: d, fake } = deps({ callLimitsEnabled: true });
  const id = target(2).shopkeeperId;
  const earlier = (hours: number): string =>
    new Date(NOW.getTime() - hours * 3600_000).toISOString();
  fake.state.recentCalls = [
    { shopkeeperId: id, queuedAt: earlier(1) },
    { shopkeeperId: id, queuedAt: earlier(2) },
    { shopkeeperId: id, queuedAt: earlier(3) },
    { shopkeeperId: target(3).shopkeeperId, queuedAt: earlier(30) },
  ];
  const batch = await queueReminders(d, [target(2), target(3)]);
  assertEquals(batch.blocked, [{ shopkeeperId: id, code: 'ATTEMPT_LIMIT_REACHED' }]);
  assertEquals(batch.simulated.length, 1);
});

Deno.test('queue › no live shopkeeper set → everyone is simulated', async () => {
  const { deps: d } = deps({ liveShopkeeperId: null });
  const batch = await queueReminders(d, [target(1)]);
  assertEquals([batch.live, batch.simulated.length], [null, 1]);
});

Deno.test('queue › at most 4 simulated calls run at once; the oldest queued starts first', async () => {
  const { deps: d, fake } = deps();
  const batch = await queueReminders(d, [2, 3, 4, 5, 6, 7].map((n) => target(n)));
  const stale = simulationStaleBefore(NOW);
  const claimed: (string | null)[] = [];
  for (let i = 0; i < 6; i += 1) {
    claimed.push(await fake.reminders.claimSimulatedCall(MAX_SIMULATED_AT_ONCE, stale));
  }
  assertEquals(claimed.slice(0, 4), batch.simulated.slice(0, 4).map((c) => c.callId));
  assertEquals(claimed.slice(4), [null, null]);
  const first = batch.simulated[0]?.callId ?? '';
  const end = { transcript: [], endedAt: NOW, durationSeconds: 30 };
  assertEquals(await fake.reminders.finishSimulatedCall(first, end), true);
  assertEquals(
    await fake.reminders.claimSimulatedCall(MAX_SIMULATED_AT_ONCE, stale),
    batch.simulated[4]?.callId,
  );
});

Deno.test('queue › a stale simulated call frees its slot and is ended for follow-up', async () => {
  const { deps: d, fake } = deps();
  const batch = await queueReminders(d, [target(2), target(3)]);
  await fake.reminders.claimSimulatedCall(1, simulationStaleBefore(NOW));
  const later = new Date(NOW.getTime() + SIMULATION_STALE_MS + 1);
  fake.state.clock = () => later;
  assertEquals(
    await fake.reminders.claimSimulatedCall(1, simulationStaleBefore(later)),
    batch.simulated[1]?.callId,
  );
  const ended = await fake.reminders.endStaleSimulatedCalls(simulationStaleBefore(later), later);
  assertEquals(ended, [batch.simulated[0]?.callId ?? '']);
  const end = { transcript: [], endedAt: later, durationSeconds: 1 };
  assertEquals(await fake.reminders.finishSimulatedCall(ended[0] ?? '', end), false);
});

// CP2 M1: attempt windows count on the real clock; the demo clock only decides calling hours.
function threeCallsBefore(clock: Date, id: string): { shopkeeperId: string; queuedAt: string }[] {
  return [1, 2, 3].map((hours) => ({
    shopkeeperId: id,
    queuedAt: new Date(clock.getTime() - hours * 3600_000).toISOString(),
  }));
}

Deno.test('queue › limits on, demo clock a day ahead: real calls today still count', async () => {
  const ahead = new Date(NOW.getTime() + 24 * 3600_000).toISOString();
  const { deps: d, fake } = deps({ callLimitsEnabled: true, demoClock: ahead });
  const id = target(2).shopkeeperId;
  fake.state.recentCalls = threeCallsBefore(NOW, id);
  const batch = await queueReminders(d, [target(2)]);
  assertEquals(batch.blocked, [{ shopkeeperId: id, code: 'ATTEMPT_LIMIT_REACHED' }]);
  assertEquals(fake.state.calls.length, 0);
});

Deno.test('queue › limits on, demo clock a day behind: yesterday does not count as today', async () => {
  const behind = new Date(NOW.getTime() - 24 * 3600_000).toISOString();
  const { deps: d, fake } = deps({ callLimitsEnabled: true, demoClock: behind });
  const id = target(2).shopkeeperId;
  const yesterday = new Date(NOW.getTime() - 24 * 3600_000);
  fake.state.recentCalls = threeCallsBefore(yesterday, id);
  const batch = await queueReminders(d, [target(2)]);
  assertEquals([batch.blocked, batch.simulated.length], [[], 1]);
});
