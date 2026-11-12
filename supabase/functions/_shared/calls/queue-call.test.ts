// supabase/functions/_shared/calls/queue-call.test.ts
import { assertEquals } from '@std/assert';
import {
  createFakeRepository,
  FAKE_LATHA,
  FAKE_NOW,
  FAKE_RAMESH,
  fakeCall,
  type FakeState,
} from '../db/fake-repository.ts';
import { queueCall, RING_RATE_LIMIT } from './queue-call.ts';

function setup(overrides: Partial<FakeState> = {}): {
  readonly run: (shopkeeperId: string) => ReturnType<typeof queueCall>;
  readonly state: FakeState;
} {
  const { repo, state } = createFakeRepository(overrides);
  const run = (shopkeeperId: string): ReturnType<typeof queueCall> =>
    queueCall({ repo, clock: () => FAKE_NOW }, { shopkeeperId, mode: 'live' });
  return { run, state };
}

const SETTINGS = {
  demoClock: null,
  callingHoursEnabled: false,
  callLimitsEnabled: false,
  liveShopkeeperId: FAKE_RAMESH.id,
};

Deno.test("queueCall › queues a live call in the shopkeeper's language", async () => {
  const { run, state } = setup();
  const result = await run(FAKE_LATHA.id);
  assertEquals(result.ok && result.alreadyQueued, false);
  assertEquals([state.calls[0]?.status, state.calls[0]?.language], ['queued', 'hi']);
});

Deno.test('queueCall › an unknown shopkeeper is not found', async () => {
  const { run, state } = setup();
  assertEquals(await run('5e000000-0000-4000-8000-000000000999'), { ok: false, code: 'NOT_FOUND' });
  assertEquals(state.calls.length, 0);
});

Deno.test('queueCall › do-not-call: reason given, no call row', async () => {
  const { run, state } = setup({ shopkeepers: [{ ...FAKE_RAMESH, doNotCall: true }] });
  assertEquals(await run(FAKE_RAMESH.id), { ok: false, code: 'DO_NOT_CALL' });
  assertEquals(state.calls.length, 0);
});

Deno.test('queueCall › calling hours switched on: blocked at night (demo clock)', async () => {
  const settings = {
    ...SETTINGS,
    callingHoursEnabled: true,
    demoClock: '2026-11-02T22:00:00+05:30',
  };
  const { run } = setup({ settings });
  assertEquals(await run(FAKE_RAMESH.id), { ok: false, code: 'OUTSIDE_CALLING_HOURS' });
});

Deno.test('queueCall › attempt limits switched on: a 4th call today is blocked', async () => {
  const earlier = ['08:00', '09:00', '10:00'].map((time) =>
    fakeCall({
      callId: crypto.randomUUID(),
      status: 'completed',
      queuedAt: new Date(`2026-11-02T${time}:00+05:30`).toISOString(),
    })
  );
  const { run } = setup({ calls: earlier, settings: { ...SETTINGS, callLimitsEnabled: true } });
  assertEquals(await run(FAKE_RAMESH.id), { ok: false, code: 'ATTEMPT_LIMIT_REACHED' });
});

Deno.test('queueCall › a call already ringing is returned instead of a second one', async () => {
  const ringingAt = new Date(FAKE_NOW.getTime() - 5_000).toISOString();
  const ringing = fakeCall({ status: 'ringing', ringingAt });
  const { run, state } = setup({ calls: [ringing] });
  assertEquals(await run(FAKE_RAMESH.id), {
    ok: true,
    callId: ringing.callId,
    alreadyQueued: true,
  });
  assertEquals(state.calls.length, 1);
});

Deno.test('queueCall › more than the rate limit in a minute is refused', async () => {
  const recent = Array.from(
    { length: RING_RATE_LIMIT.maxCalls },
    () =>
      fakeCall({
        callId: crypto.randomUUID(),
        status: 'declined',
        queuedAt: FAKE_NOW.toISOString(),
      }),
  );
  const { run } = setup({ calls: recent });
  assertEquals(await run(FAKE_RAMESH.id), { ok: false, code: 'RATE_LIMITED' });
});

Deno.test('queueCall › a stale ringing call does not block a new one', async () => {
  const stale = fakeCall({ status: 'ringing', ringingAt: '2026-11-02T06:00:00.000Z' });
  const { run, state } = setup({ calls: [stale] });
  const result = await run(FAKE_RAMESH.id);
  assertEquals(result.ok && result.alreadyQueued, false);
  assertEquals(state.calls.length, 2);
});

// CP2 M1: attempt windows count on the real clock; the demo clock only decides calling hours.
function threeCallsToday(): ReturnType<typeof fakeCall>[] {
  return ['08:00', '09:00', '10:00'].map((time) =>
    fakeCall({
      callId: crypto.randomUUID(),
      status: 'completed',
      queuedAt: new Date(`2026-11-02T${time}:00+05:30`).toISOString(),
    })
  );
}

Deno.test('queueCall › limits on, demo clock a day ahead: real calls today still count', async () => {
  const settings = { ...SETTINGS, callLimitsEnabled: true, demoClock: '2026-11-03T12:00:00+05:30' };
  const { run, state } = setup({ calls: threeCallsToday(), settings });
  assertEquals(await run(FAKE_RAMESH.id), { ok: false, code: 'ATTEMPT_LIMIT_REACHED' });
  assertEquals(state.calls.length, 3);
});

Deno.test('queueCall › limits on, demo clock a day behind: yesterday does not count as today', async () => {
  const yesterday = ['08:00', '09:00', '10:00'].map((time) =>
    fakeCall({
      callId: crypto.randomUUID(),
      status: 'completed',
      queuedAt: new Date(`2026-11-01T${time}:00+05:30`).toISOString(),
    })
  );
  const settings = { ...SETTINGS, callLimitsEnabled: true, demoClock: '2026-11-01T21:00:00+05:30' };
  const { run, state } = setup({ calls: yesterday, settings });
  const result = await run(FAKE_RAMESH.id);
  assertEquals(result.ok && result.alreadyQueued, false);
  assertEquals(state.calls.length, 4);
});

Deno.test('queueCall › paused: no call row, the reason says so; resumed: the call is queued (M9)', async () => {
  const paused = setup({ settings: { ...SETTINGS, callsPaused: true } });
  assertEquals(await paused.run(FAKE_RAMESH.id), { ok: false, code: 'CALLS_PAUSED' });
  assertEquals(paused.state.calls.length, 0);
  const resumed = setup({ settings: { ...SETTINGS, callsPaused: false } });
  assertEquals((await resumed.run(FAKE_RAMESH.id)).ok, true);
});
