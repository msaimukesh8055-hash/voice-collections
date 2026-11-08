// supabase/functions/calls-api/munshi-routes.test.ts
// M8 A3 (security, 100%): the /munshi page's steps through the calls-api handler. The session
// check changes nothing; accept works once, only from issued and unexpired; ended only from
// accepted / in progress; a tampered, unknown or missing token gets nothing. Fakes only.
import { assertEquals } from '@std/assert';
import { signOwnerCallToken } from '../_shared/auth/owner-call-link.ts';
import { createFakeRepository, FAKE_NOW, fakeCall } from '../_shared/db/fake-repository.ts';
import { FAKE_OWNER } from '../_shared/db/fake-book-repository.ts';
import { type FakeOwnerCall, fakeOwnerCall } from '../_shared/db/fake-owner-call-repository.ts';
import { CALL_TOKEN_HEADER } from '../_shared/sarvam.ts';
import { dashboardSetup } from './__fixtures__/dashboard.ts';
import { MUNSHI_LINK_SECRET, munshiSetup } from './__fixtures__/munshi.ts';
import { handleCallsApi } from './handler.ts';
import type { CallsApiDeps, MunshiDeps } from './types.ts';

const BASE = 'https://ref.supabase.co/functions/v1/calls-api';
const MUNSHI_APP = 'Munshi-Easy-Recovery-1';
const ID = 'ca000000-0000-4000-8000-0000000000b1';

function minutesFromNow(minutes: number): string {
  return new Date(FAKE_NOW.getTime() + minutes * 60_000).toISOString();
}

/** A fresh link: issued a minute ago, expiring in 14 minutes. */
function issued(overrides: Partial<FakeOwnerCall> = {}): FakeOwnerCall {
  return fakeOwnerCall({
    status: 'issued',
    issuedAt: minutesFromNow(-1),
    expiresAt: minutesFromNow(14),
    acceptedAt: null,
    ...overrides,
  });
}

interface Setup {
  readonly deps: CallsApiDeps;
  readonly rows: () => readonly FakeOwnerCall[];
  readonly logs: string[];
}

function setup(
  rows: readonly FakeOwnerCall[] = [issued()],
  options: { munshiAppId?: string | null; munshi?: Partial<MunshiDeps> } = {},
): Setup {
  const { repo } = createFakeRepository({
    settings: {
      demoClock: '2026-11-07T10:00:00+05:30',
      callingHoursEnabled: false,
      callLimitsEnabled: false,
      liveShopkeeperId: null,
    },
  });
  const owner = munshiSetup({ ownerCalls: { ownerCalls: rows } });
  const logs: string[] = [];
  const deps: CallsApiDeps = {
    repo,
    clock: () => FAKE_NOW,
    log: (_level, event) => logs.push(event),
    allowedOrigins: [],
    sarvam: {
      apiKey: 'agents-key',
      orgId: 'org-1',
      workspaceId: 'ws-1',
      appId: 'Asha-1',
      munshiAppId: options.munshiAppId === undefined ? MUNSHI_APP : options.munshiAppId,
    },
    fetchImpl: () => Promise.reject(new Error('no network in tests')),
    kickFollowup: () => {},
    dashboard: dashboardSetup().dashboard,
    munshi: { ...owner.munshi, ...options.munshi },
  };
  return { deps, rows: () => owner.state.ownerCalls, logs };
}

function token(id = ID, secret = MUNSHI_LINK_SECRET): Promise<string> {
  return signOwnerCallToken(secret, id);
}

function call(
  path: string,
  init: { method?: string; token?: string | null; body?: unknown } = {},
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token) headers[CALL_TOKEN_HEADER] = init.token;
  return new Request(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function errorCode(response: Response): Promise<unknown> {
  return ((await json(response))['error'] as { code: string }).code;
}

async function session(s: Setup, value: string | null): Promise<unknown> {
  return (await json(await handleCallsApi(call('/v1/munshi/session', { token: value }), s.deps)))[
    'state'
  ];
}

function accept(s: Setup, value: string | null): Promise<Response> {
  return handleCallsApi(call('/v1/munshi/accept', { method: 'POST', token: value }), s.deps);
}

function ended(s: Setup, value: string | null, body: unknown): Promise<Response> {
  return handleCallsApi(call('/v1/munshi/ended', { method: 'POST', token: value, body }), s.deps);
}

Deno.test('munshi › session: a fresh link is ready, and checking it changes nothing', async () => {
  const s = setup();
  assertEquals(await session(s, await token()), 'ready');
  assertEquals(await session(s, await token()), 'ready');
  assertEquals(s.rows()[0]?.status, 'issued');
});

Deno.test('munshi › session: used, expired, tampered, unknown and missing tokens', async () => {
  const states = [
    [issued({ status: 'accepted' }), 'used'],
    [issued({ status: 'in_progress' }), 'used'],
    [issued({ status: 'completed' }), 'used'],
    [issued({ status: 'expired' }), 'expired'],
    [issued({ expiresAt: minutesFromNow(0) }), 'expired'],
  ] as const;
  for (const [row, expected] of states) {
    assertEquals(await session(setup([row]), await token()), expected, row.status);
  }
  const s = setup();
  assertEquals(await session(s, `${(await token()).slice(0, -1)}x`), 'expired');
  assertEquals(
    await session(s, await token(ID, 'another-secret-of-32-characters-long')),
    'expired',
  );
  assertEquals(await session(s, await token(crypto.randomUUID())), 'expired');
  assertEquals(await session(s, null), 'expired');
  assertEquals(await session(s, ID), 'expired');
});

Deno.test('munshi › not set up (no app id or no link secret) → VOICE_NOT_CONFIGURED', async () => {
  for (
    const s of [
      setup([issued()], { munshiAppId: null }),
      setup([issued()], { munshi: { linkSecret: null } }),
    ]
  ) {
    const value = await token();
    assertEquals(
      await errorCode(await handleCallsApi(call('/v1/munshi/session', { token: value }), s.deps)),
      'VOICE_NOT_CONFIGURED',
    );
    assertEquals(await errorCode(await accept(s, value)), 'VOICE_NOT_CONFIGURED');
    assertEquals(s.rows()[0]?.status, 'issued');
  }
});

Deno.test('munshi › accept: issued → accepted once, with the variables and Munshi’s ids', async () => {
  const s = setup();
  const response = await accept(s, await token());
  assertEquals(response.status, 200);
  assertEquals(await json(response), {
    ownerCallToken: ID,
    ownerName: 'Srinivas Reddy',
    ownerShortName: 'Srinivas',
    businessName: 'Sri Lakshmi Traders',
    today: 'Saturday, 2026-11-07',
    sarvam: { orgId: 'org-1', workspaceId: 'ws-1', appId: MUNSHI_APP },
  });
  assertEquals(s.rows()[0]?.status, 'accepted');
  assertEquals(s.rows()[0]?.acceptedAt, FAKE_NOW.toISOString());
  assertEquals(await errorCode(await accept(s, await token())), 'CALL_STATE_CONFLICT');
  assertEquals(s.logs.filter((event) => event === 'owner_call_accepted').length, 1);
});

Deno.test("munshi › accept: expired, used or another owner's link is refused, row unchanged", async () => {
  for (
    const row of [
      issued({ expiresAt: minutesFromNow(-1) }),
      issued({ status: 'expired' }),
      issued({ status: 'completed' }),
      issued({ ownerId: crypto.randomUUID() }),
    ]
  ) {
    const s = setup([row]);
    assertEquals(await errorCode(await accept(s, await token())), 'CALL_STATE_CONFLICT');
    assertEquals(s.rows()[0]?.status, row.status);
  }
  const noOwner = setup([issued()], { munshi: { getOwner: () => Promise.resolve(null) } });
  assertEquals(await errorCode(await accept(noOwner, await token())), 'CALL_STATE_CONFLICT');
  assertEquals(noOwner.rows()[0]?.status, 'issued');
});

Deno.test('munshi › accept: a tampered, unknown or missing token → NOT_FOUND, nothing changes', async () => {
  const s = setup();
  for (
    const value of [null, ID, `${(await token()).slice(0, -1)}x`, await token(crypto.randomUUID())]
  ) {
    assertEquals(await errorCode(await accept(s, value)), 'NOT_FOUND');
  }
  assertEquals(s.rows()[0]?.status, 'issued');
});

Deno.test('munshi › accept: two Start calls racing → one accept', async () => {
  const s = setup();
  const value = await token();
  const results = await Promise.all([accept(s, value), accept(s, value)]);
  assertEquals(results.map((response) => response.status).sort(), [200, 409]);
});

Deno.test('munshi › a shopkeeper call token is no owner token', async () => {
  const s = setup();
  const shopkeeperCallId = 'ca000000-0000-4000-8000-0000000000aa';
  assertEquals(await session(s, shopkeeperCallId), 'expired');
  assertEquals(await errorCode(await accept(s, shopkeeperCallId)), 'NOT_FOUND');
});

Deno.test('munshi › ended: accepted or in progress → completed with seconds and id', async () => {
  for (const status of ['accepted', 'in_progress'] as const) {
    const s = setup([issued({ status, acceptedAt: minutesFromNow(-3) })]);
    const response = await ended(s, await token(), {
      seconds: 180,
      interactionId: '20261107/abc-10:00:00-1',
    });
    assertEquals(await json(response), { status: 'completed' });
    assertEquals(s.rows()[0]?.status, 'completed');
    assertEquals(s.rows()[0]?.durationSeconds, 180);
    assertEquals(s.rows()[0]?.interactionId, '20261107/abc-10:00:00-1');
    assertEquals(s.rows()[0]?.endedAt, FAKE_NOW.toISOString());
  }
  const noId = setup([issued({ status: 'accepted' })]);
  await ended(noId, await token(), { seconds: 0 });
  assertEquals(noId.rows()[0]?.interactionId, null);
});

Deno.test('munshi › ended: refused from issued, completed or expired; bad body; bad token', async () => {
  for (const status of ['issued', 'completed', 'expired'] as const) {
    const s = setup([issued({ status })]);
    assertEquals(
      await errorCode(await ended(s, await token(), { seconds: 10 })),
      'CALL_STATE_CONFLICT',
    );
    assertEquals(s.rows()[0]?.status, status);
  }
  const s = setup([issued({ status: 'accepted' })]);
  assertEquals(await errorCode(await ended(s, await token(), { seconds: -1 })), 'BAD_REQUEST');
  assertEquals(await errorCode(await ended(s, null, { seconds: 10 })), 'NOT_FOUND');
  assertEquals(
    await errorCode(await ended(s, await token(), { seconds: 10, interactionId: 'bad id!' })),
    'BAD_REQUEST',
  );
  assertEquals(s.rows()[0]?.status, 'accepted');
});

Deno.test('munshi › ended: no link secret → no token verifies (NOT_FOUND)', async () => {
  const s = setup([issued({ status: 'accepted' })], { munshi: { linkSecret: null } });
  assertEquals(await errorCode(await ended(s, await token(), { seconds: 10 })), 'NOT_FOUND');
  assertEquals(s.rows()[0]?.status, 'accepted');
});

Deno.test('munshi › owner FAKE data: the default owner matches the owner call', () => {
  assertEquals(fakeOwnerCall().ownerId, FAKE_OWNER.id);
});

Deno.test('munshi › the phone page does not ring while Munshi talks, and rings after', async () => {
  const live = fakeOwnerCall({ status: 'in_progress', acceptedAt: minutesFromNow(-2) });
  const queued = {
    callId: 'ca000000-0000-4000-8000-0000000000aa',
    status: 'queued' as const,
    queuedAt: minutesFromNow(-1),
    ringingAt: null,
    acceptedAt: null,
  };
  const s = setup([live]);
  const { repo, state } = createFakeRepository({ calls: [fakeCall(queued)] });
  const deps = { ...s.deps, repo };
  const busy = await json(await handleCallsApi(call('/v1/phone/incoming'), deps));
  assertEquals([busy, state.calls[0]?.status], [{ call: null }, 'queued']);
  const afterwards = { ...deps, clock: () => new Date(FAKE_NOW.getTime() + 10 * 60_000) };
  const rings = await json(await handleCallsApi(call('/v1/phone/incoming'), afterwards));
  assertEquals((rings['call'] as { callToken: string }).callToken, queued.callId);
});

Deno.test('munshi › accept: 1 ms before the 15-minute expiry works; at expiry → conflict', async () => {
  const early = setup([issued({ expiresAt: new Date(FAKE_NOW.getTime() + 1).toISOString() })]);
  const atExpiry = setup([issued({ expiresAt: FAKE_NOW.toISOString() })]);
  assertEquals((await accept(early, await token())).status, 200);
  assertEquals(await errorCode(await accept(atExpiry, await token())), 'CALL_STATE_CONFLICT');
  assertEquals(atExpiry.rows()[0]?.status, 'issued');
});

Deno.test('munshi › a link for one owner call never opens another owner call', async () => {
  const other = 'ca000000-0000-4000-8000-0000000000b2';
  const s = setup([issued(), issued({ id: other })]);
  const signature = (await token()).split('.')[1];
  assertEquals(await errorCode(await accept(s, `${other}.${signature}`)), 'NOT_FOUND');
  assertEquals(s.rows().map((row) => row.status), ['issued', 'issued']);
});

Deno.test('munshi › ended twice: the second is a conflict and changes nothing', async () => {
  const s = setup([issued({ status: 'in_progress', acceptedAt: minutesFromNow(-3) })]);
  const value = await token();
  const first = await ended(s, value, { interactionId: 'i-1', seconds: 120 });
  const second = await ended(s, value, { interactionId: 'i-2', seconds: 5 });
  assertEquals([first.status, await errorCode(second)], [200, 'CALL_STATE_CONFLICT']);
  assertEquals(s.rows()[0]?.durationSeconds, 120);
});

Deno.test('munshi › accept: losing the compare-and-set after the read → conflict, no variables', async () => {
  const s = setup();
  const ownerCalls = {
    ...s.deps.munshi.ownerCalls,
    transitionOwnerCall: () => Promise.resolve(false),
  };
  const deps = { ...s.deps, munshi: { ...s.deps.munshi, ownerCalls } };
  const req = call('/v1/munshi/accept', { method: 'POST', token: await token() });
  const response = await handleCallsApi(req, deps);
  assertEquals(await errorCode(response), 'CALL_STATE_CONFLICT');
  assertEquals(s.logs.includes('owner_call_accepted'), false);
});
