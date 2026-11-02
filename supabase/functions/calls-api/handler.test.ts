// supabase/functions/calls-api/handler.test.ts
import { assertEquals } from '@std/assert';
import {
  createFakeRepository,
  FAKE_ANITA,
  FAKE_RAVI,
  fakeCall,
  type FakeState,
} from '../_shared/db/fake-repository.ts';
import type { Logger } from '../_shared/log.ts';
import { type CallsApiDeps, handleCallsApi } from './handler.ts';

const ORIGIN = 'http://localhost:5173';
const NOON_IST = new Date('2026-11-01T12:00:00+05:30');
const BASE = 'https://ref.supabase.co/functions/v1/calls-api';

function setup(overrides: Partial<FakeState> = {}): { deps: CallsApiDeps; state: FakeState } {
  const { repo, state } = createFakeRepository(overrides);
  const log: Logger = () => {};
  return { deps: { repo, clock: () => NOON_IST, log, allowedOrigins: [ORIGIN] }, state };
}

function authorize(customerId: unknown, origin = ORIGIN): Request {
  return new Request(`${BASE}/v1/calls/authorize`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ customerId }),
  });
}

async function errorCodeOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

Deno.test('calls-api › GET /v1/customers lists name, language and city only', async () => {
  const { deps } = setup();
  const response = await handleCallsApi(
    new Request(`${BASE}/v1/customers`, { headers: { origin: ORIGIN } }),
    deps,
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('access-control-allow-origin'), ORIGIN);
  const body = (await response.json()) as { customers: Array<Record<string, unknown>> };
  assertEquals(body.customers[0], {
    id: FAKE_RAVI.id,
    fullName: 'Ravi Sharma',
    language: 'hi',
    city: 'Pune',
  });
  assertEquals(JSON.stringify(body).includes(FAKE_RAVI.dob), false);
});

Deno.test('calls-api › CORS preflight: allowed origin echoed, unknown origin not', async () => {
  const { deps } = setup();
  const preflight = (origin: string): Request =>
    new Request(`${BASE}/v1/calls/authorize`, { method: 'OPTIONS', headers: { origin } });
  const allowed = await handleCallsApi(preflight(ORIGIN), deps);
  assertEquals(allowed.status, 204);
  assertEquals(allowed.headers.get('access-control-allow-origin'), ORIGIN);
  const denied = await handleCallsApi(preflight('https://evil.example'), deps);
  assertEquals(denied.headers.get('access-control-allow-origin'), null);
});

Deno.test('calls-api › authorise allowed → 201 with token, name and language; call row created', async () => {
  const { deps, state } = setup();
  const response = await handleCallsApi(authorize(FAKE_ANITA.id), deps);
  assertEquals(response.status, 201);
  const body = (await response.json()) as Record<string, unknown>;
  assertEquals(body['customerName'], 'Anita Desai');
  assertEquals(body['language'], 'en');
  assertEquals(body['today'], 'Sunday, 2026-11-01');
  assertEquals(state.calls.length, 1);
  assertEquals(body['callToken'], state.calls[0]?.id);
  assertEquals(state.calls[0]?.attemptNo, 1);
});

Deno.test("calls-api › attempt number counts today's earlier calls", async () => {
  const earlier = fakeCall({ id: crypto.randomUUID(), startedAt: '2026-11-01T09:00:00+05:30' });
  const { deps, state } = setup({ calls: [earlier] });
  await handleCallsApi(authorize(FAKE_ANITA.id), deps);
  assertEquals(state.calls[1]?.attemptNo, 2);
});

Deno.test('calls-api › with the calling-hours switch off, a 21:00 call is allowed', async () => {
  const { deps } = setup({
    settings: {
      demoClock: '2026-11-01T21:00:00+05:30',
      callingHoursEnabled: false,
      callLimitsEnabled: false,
    },
  });
  assertEquals((await handleCallsApi(authorize(FAKE_ANITA.id), deps)).status, 201);
});

Deno.test('calls-api › demo clock at 21:00 IST blocks the call when the switch is on, no call row', async () => {
  const { deps, state } = setup({
    settings: {
      demoClock: '2026-11-01T21:00:00+05:30',
      callingHoursEnabled: true,
      callLimitsEnabled: false,
    },
  });
  const response = await handleCallsApi(authorize(FAKE_ANITA.id), deps);
  assertEquals(response.status, 409);
  assertEquals(await errorCodeOf(response), 'OUTSIDE_CALLING_HOURS');
  assertEquals(state.calls.length, 0);
});

Deno.test('calls-api › do-not-call customer is blocked', async () => {
  const { deps } = setup({ customers: [{ ...FAKE_ANITA, doNotCall: true }] });
  const response = await handleCallsApi(authorize(FAKE_ANITA.id), deps);
  assertEquals(await errorCodeOf(response), 'DO_NOT_CALL');
});

Deno.test('calls-api › attempt limits apply only when switched on', async () => {
  const today = [1, 2, 3].map(() =>
    fakeCall({ id: crypto.randomUUID(), startedAt: '2026-11-01T09:00:00+05:30' })
  );
  const off = setup({ calls: today });
  assertEquals((await handleCallsApi(authorize(FAKE_ANITA.id), off.deps)).status, 201);
  const on = setup({
    calls: today,
    settings: { demoClock: null, callingHoursEnabled: false, callLimitsEnabled: true },
  });
  const response = await handleCallsApi(authorize(FAKE_ANITA.id), on.deps);
  assertEquals(await errorCodeOf(response), 'ATTEMPT_LIMIT_REACHED');
});

Deno.test('calls-api › a 4th authorise for one customer within a minute → 429, no call row (CP1 M2)', async () => {
  const justNow = [10, 20, 30].map((secondsAgo) =>
    fakeCall({
      id: crypto.randomUUID(),
      startedAt: new Date(NOON_IST.getTime() - secondsAgo * 1000).toISOString(),
    })
  );
  const { deps, state } = setup({ calls: justNow });
  const response = await handleCallsApi(authorize(FAKE_ANITA.id), deps);
  assertEquals(response.status, 429);
  assertEquals(await errorCodeOf(response), 'RATE_LIMITED');
  assertEquals(state.calls.length, 3);
});

Deno.test('calls-api › the rate limit is per customer and forgets calls older than a minute', async () => {
  const minuteAgo = new Date(NOON_IST.getTime() - 61_000).toISOString();
  const anita = [1, 2, 3].map(() => fakeCall({ id: crypto.randomUUID(), startedAt: minuteAgo }));
  const ravi = [1, 2, 3].map(() =>
    fakeCall({
      id: crypto.randomUUID(),
      customerId: FAKE_RAVI.id,
      startedAt: NOON_IST.toISOString(),
    })
  );
  const { deps } = setup({ calls: [...anita, ...ravi] });
  assertEquals((await handleCallsApi(authorize(FAKE_ANITA.id), deps)).status, 201);
});

Deno.test('calls-api › weekly limit counts calls from the last 7 India days', async () => {
  const week = [
    '2026-10-26',
    '2026-10-27',
    '2026-10-28',
    '2026-10-29',
    '2026-10-30',
    '2026-10-31',
    '2026-10-31',
  ]
    .map((day) => fakeCall({ id: crypto.randomUUID(), startedAt: `${day}T10:00:00+05:30` }));
  const tooOld = fakeCall({ id: crypto.randomUUID(), startedAt: '2026-10-25T23:00:00+05:30' });
  const { deps } = setup({
    calls: [tooOld, ...week],
    settings: { demoClock: null, callingHoursEnabled: false, callLimitsEnabled: true },
  });
  const response = await handleCallsApi(authorize(FAKE_ANITA.id), deps);
  assertEquals(await errorCodeOf(response), 'ATTEMPT_LIMIT_REACHED');
});

Deno.test('calls-api › unknown customer → 404; bad body → 400', async () => {
  const { deps } = setup();
  assertEquals((await handleCallsApi(authorize(crypto.randomUUID()), deps)).status, 404);
  assertEquals((await handleCallsApi(authorize('not-a-uuid'), deps)).status, 400);
});

Deno.test('calls-api › unknown route → 404; wrong method → 405', async () => {
  const { deps } = setup();
  assertEquals((await handleCallsApi(new Request(`${BASE}/v1/loans`), deps)).status, 404);
  const wrongMethod = new Request(`${BASE}/v1/customers`, { method: 'DELETE' });
  assertEquals((await handleCallsApi(wrongMethod, deps)).status, 405);
});

Deno.test('calls-api › routes also match without the function prefix (local serve)', async () => {
  const { deps } = setup();
  const response = await handleCallsApi(new Request('http://localhost:8000/v1/customers'), deps);
  assertEquals(response.status, 200);
});
