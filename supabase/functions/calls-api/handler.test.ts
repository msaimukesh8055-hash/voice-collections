// supabase/functions/calls-api/handler.test.ts
import { assert, assertEquals } from '@std/assert';
import {
  createFakeRepository,
  FAKE_LATHA,
  FAKE_NOW,
  FAKE_RAMESH,
  type FakeCall,
  fakeCall,
  type FakeState,
} from '../_shared/db/fake-repository.ts';
import type { Logger } from '../_shared/log.ts';
import { CALL_TOKEN_HEADER } from '../_shared/sarvam.ts';
import { handleCallsApi } from './handler.ts';
import { dashboardSetup } from './__fixtures__/dashboard.ts';
import { munshiSetup } from './__fixtures__/munshi.ts';
import type { SarvamSettings } from './sarvam-proxy.ts';
import type { CallsApiDeps } from './types.ts';

const ORIGIN = 'http://localhost:5173';
const BASE = 'https://ref.supabase.co/functions/v1/calls-api';
const SARVAM = {
  apiKey: 'agents-key',
  orgId: 'org-1',
  workspaceId: 'ws-1',
  appId: 'app-1',
  munshiAppId: null,
};
const SECONDS_AGO = (seconds: number): string =>
  new Date(FAKE_NOW.getTime() - seconds * 1000).toISOString();

function setup(overrides: Partial<FakeState> = {}, sarvam: Partial<SarvamSettings> = {}): {
  deps: CallsApiDeps;
  state: FakeState;
  kicked: string[];
} {
  const kicked: string[] = [];
  const { repo, state } = createFakeRepository(overrides);
  const log: Logger = () => {};
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(Response.json({ url: 'wss://signed', reference_id: 'ref-1' }));
  const deps: CallsApiDeps = {
    repo,
    clock: () => FAKE_NOW,
    log,
    allowedOrigins: [ORIGIN],
    sarvam: { ...SARVAM, ...sarvam },
    fetchImpl,
    kickFollowup: (callId) => kicked.push(callId),
    dashboard: dashboardSetup().dashboard,
    munshi: munshiSetup().munshi,
  };
  return { deps, state, kicked };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, {
    ...init,
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...init.headers },
  });
}

const post = (path: string, body: unknown = {}): Request =>
  request(path, { method: 'POST', body: JSON.stringify(body) });

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function errorCode(response: Response): Promise<unknown> {
  return ((await json(response))['error'] as { code: string }).code;
}

function ringingCall(overrides: Partial<FakeCall> = {}): FakeCall {
  return fakeCall({ status: 'ringing', ringingAt: SECONDS_AGO(5), acceptedAt: null, ...overrides });
}

const TOKEN = fakeCall().callId;

Deno.test('calls-api › CORS preflight: allowed origin echoed with the SDK headers', async () => {
  const { deps } = setup();
  const allowed = await handleCallsApi(request('/v1/demo/ring', { method: 'OPTIONS' }), deps);
  assertEquals(allowed.status, 204);
  assertEquals(allowed.headers.get('access-control-allow-origin'), ORIGIN);
  assert(allowed.headers.get('access-control-allow-headers')?.includes(CALL_TOKEN_HEADER));
  const denied = await handleCallsApi(
    new Request(`${BASE}/v1/demo/ring`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    }),
    deps,
  );
  assertEquals(denied.headers.get('access-control-allow-origin'), null);
});

Deno.test('calls-api › unknown path → 404; wrong method → 405', async () => {
  const { deps } = setup();
  assertEquals((await handleCallsApi(request('/v1/customers'), deps)).status, 404);
  assertEquals((await handleCallsApi(request('/v1/demo/ring'), deps)).status, 405);
});

Deno.test('calls-api › GET /v1/demo names the live shopkeeper', async () => {
  const { deps } = setup();
  const body = await json(await handleCallsApi(request('/v1/demo'), deps));
  assertEquals(body, { liveShopkeeper: { name: 'Ramesh', shopName: 'Ramesh Kirana' } });
});

Deno.test('calls-api › GET /v1/demo with no live shopkeeper → null', async () => {
  const settings = {
    demoClock: null,
    callingHoursEnabled: false,
    callLimitsEnabled: false,
    liveShopkeeperId: null,
  };
  const { deps } = setup({ settings });
  assertEquals(await json(await handleCallsApi(request('/v1/demo'), deps)), {
    liveShopkeeper: null,
  });
});

Deno.test('calls-api › ring → a queued call for the live shopkeeper', async () => {
  const { deps, state } = setup();
  const response = await handleCallsApi(post('/v1/demo/ring'), deps);
  assertEquals(response.status, 201);
  assertEquals(await json(response), { status: 'queued', alreadyQueued: false });
  assertEquals([state.calls[0]?.status, state.calls[0]?.shopkeeperId], ['queued', FAKE_RAMESH.id]);
});

Deno.test('calls-api › ring a do-not-call shopkeeper → reason, no call row', async () => {
  const { deps, state } = setup({ shopkeepers: [{ ...FAKE_RAMESH, doNotCall: true }] });
  const response = await handleCallsApi(post('/v1/demo/ring'), deps);
  assertEquals(await errorCode(response), 'DO_NOT_CALL');
  assertEquals(state.calls.length, 0);
});

Deno.test('calls-api › ring with no live shopkeeper set → refused', async () => {
  const settings = {
    demoClock: null,
    callingHoursEnabled: false,
    callLimitsEnabled: false,
    liveShopkeeperId: null,
  };
  const { deps } = setup({ settings });
  assertEquals(
    await errorCode(await handleCallsApi(post('/v1/demo/ring'), deps)),
    'NO_LIVE_SHOPKEEPER',
  );
});

Deno.test('calls-api › incoming: nothing queued → no call', async () => {
  const { deps } = setup();
  assertEquals(await json(await handleCallsApi(request('/v1/phone/incoming'), deps)), {
    call: null,
  });
});

Deno.test('calls-api › incoming: a queued call starts ringing, shown as the business', async () => {
  const queued = fakeCall({
    status: 'queued',
    queuedAt: SECONDS_AGO(3),
    ringingAt: null,
    acceptedAt: null,
  });
  const { deps, state } = setup({ calls: [queued] });
  const body = await json(await handleCallsApi(request('/v1/phone/incoming'), deps));
  assertEquals(body, {
    call: {
      callToken: queued.callId,
      callerName: 'Sri Lakshmi Traders',
      shopkeeperName: 'Ramesh',
      shopName: 'Ramesh Kirana',
    },
  });
  assertEquals([state.calls[0]?.status, state.calls[0]?.ringingAt], [
    'ringing',
    FAKE_NOW.toISOString(),
  ]);
});

Deno.test('calls-api › incoming: a call ringing over 30 s is marked missed', async () => {
  const { deps, state } = setup({ calls: [ringingCall({ ringingAt: SECONDS_AGO(31) })] });
  assertEquals(await json(await handleCallsApi(request('/v1/phone/incoming'), deps)), {
    call: null,
  });
  assertEquals(state.calls[0]?.status, 'missed');
});

Deno.test("calls-api › incoming: any shopkeeper's live call rings, showing who it is for", async () => {
  const settings = {
    demoClock: null,
    callingHoursEnabled: false,
    callLimitsEnabled: false,
    liveShopkeeperId: null,
  };
  const latha = ringingCall({ shopkeeperId: FAKE_LATHA.id });
  const { deps } = setup({ settings, calls: [latha] });
  const body = await json(await handleCallsApi(request('/v1/phone/incoming'), deps));
  assertEquals(body, {
    call: {
      callToken: latha.callId,
      callerName: 'Sri Lakshmi Traders',
      shopkeeperName: FAKE_LATHA.name,
      shopName: FAKE_LATHA.shopName,
    },
  });
});

Deno.test('calls-api › incoming: one live call at a time; the next waits, then rings', async () => {
  const onCall = fakeCall({ status: 'in_progress', acceptedAt: SECONDS_AGO(60) });
  const waiting = fakeCall({
    callId: 'ca000000-0000-4000-8000-0000000000bb',
    shopkeeperId: FAKE_LATHA.id,
    status: 'queued',
    queuedAt: SECONDS_AGO(30),
    ringingAt: null,
    acceptedAt: null,
  });
  const { deps, state } = setup({ calls: [onCall, waiting] });
  const busy = await json(await handleCallsApi(request('/v1/phone/incoming'), deps));
  assertEquals([busy, state.calls[1]?.status], [{ call: null }, 'queued']);
  await handleCallsApi(post(`/v1/calls/${TOKEN}/ended`, { seconds: 60 }), deps);
  const next = await json(await handleCallsApi(request('/v1/phone/incoming'), deps));
  assertEquals((next['call'] as { callToken: string }).callToken, waiting.callId);
});

Deno.test('calls-api › incoming: simulated calls never ring the phone page', async () => {
  const { deps } = setup({ calls: [ringingCall({ mode: 'simulated' })] });
  assertEquals(await json(await handleCallsApi(request('/v1/phone/incoming'), deps)), {
    call: null,
  });
});

Deno.test('calls-api › incoming: a call for a missing shopkeeper is not shown', async () => {
  const { deps } = setup({ shopkeepers: [], calls: [ringingCall()] });
  assertEquals(await json(await handleCallsApi(request('/v1/phone/incoming'), deps)), {
    call: null,
  });
});

Deno.test('calls-api › accept: only from ringing; returns names, language and Sarvam ids', async () => {
  const { deps, state } = setup({ calls: [ringingCall()] });
  const response = await handleCallsApi(post(`/v1/calls/${TOKEN}/accept`), deps);
  assertEquals(response.status, 200);
  assertEquals(await json(response), {
    callToken: TOKEN,
    language: 'te',
    shopkeeperName: 'Ramesh',
    shopName: 'Ramesh Kirana',
    ownerName: 'Srinivas Reddy',
    businessName: 'Sri Lakshmi Traders',
    today: 'Monday, 2026-11-02',
    sarvam: { orgId: 'org-1', workspaceId: 'ws-1', appId: 'app-1' },
  });
  assertEquals([state.calls[0]?.status, state.calls[0]?.acceptedAt], [
    'accepted',
    FAKE_NOW.toISOString(),
  ]);
});

Deno.test('calls-api › accept twice → the second is refused', async () => {
  const { deps } = setup({ calls: [ringingCall()] });
  await handleCallsApi(post(`/v1/calls/${TOKEN}/accept`), deps);
  const second = await handleCallsApi(post(`/v1/calls/${TOKEN}/accept`), deps);
  assertEquals(await errorCode(second), 'CALL_STATE_CONFLICT');
});

Deno.test('calls-api › accept after the 30 s ring → refused', async () => {
  const { deps } = setup({ calls: [ringingCall({ ringingAt: SECONDS_AGO(40) })] });
  assertEquals(
    await errorCode(await handleCallsApi(post(`/v1/calls/${TOKEN}/accept`), deps)),
    'CALL_STATE_CONFLICT',
  );
});

Deno.test('calls-api › accept loses a race with decline → refused', async () => {
  const { deps } = setup({ calls: [ringingCall()] });
  const raced = { ...deps, repo: { ...deps.repo, transitionCall: () => Promise.resolve(false) } };
  assertEquals(
    await errorCode(await handleCallsApi(post(`/v1/calls/${TOKEN}/accept`), raced)),
    'CALL_STATE_CONFLICT',
  );
});

Deno.test('calls-api › accept with no Sarvam app set up → refused before anything changes', async () => {
  const { deps, state } = setup({ calls: [ringingCall()] }, { appId: null });
  const response = await handleCallsApi(post(`/v1/calls/${TOKEN}/accept`), deps);
  assertEquals(await errorCode(response), 'VOICE_NOT_CONFIGURED');
  assertEquals(state.calls[0]?.status, 'ringing');
});

Deno.test('calls-api › unknown or malformed token → 404', async () => {
  const { deps } = setup();
  assertEquals(
    (await handleCallsApi(post(`/v1/calls/${crypto.randomUUID()}/accept`), deps)).status,
    404,
  );
  assertEquals((await handleCallsApi(post('/v1/calls/not-a-token/decline'), deps)).status, 404);
});

Deno.test('calls-api › decline → declined; declining an accepted call is refused', async () => {
  const { deps, state } = setup({ calls: [ringingCall()] });
  const response = await handleCallsApi(post(`/v1/calls/${TOKEN}/decline`), deps);
  assertEquals(await json(response), { status: 'declined' });
  assertEquals(state.calls[0]?.status, 'declined');
  const accepted = setup({ calls: [fakeCall()] });
  const refused = await handleCallsApi(post(`/v1/calls/${TOKEN}/decline`), accepted.deps);
  assertEquals(await errorCode(refused), 'CALL_STATE_CONFLICT');
});

Deno.test('calls-api › ended → completed with duration and interaction id', async () => {
  const { deps, state } = setup({ calls: [fakeCall({ status: 'in_progress' })] });
  const body = { interactionId: '20261102/182f511f-21:45:10-8bfe8bd5', seconds: 95 };
  const response = await handleCallsApi(post(`/v1/calls/${TOKEN}/ended`, body), deps);
  assertEquals(await json(response), { status: 'completed' });
  const call = state.calls[0];
  assertEquals([call?.status, call?.durationSeconds, call?.interactionId], [
    'completed',
    95,
    '20261102/182f511f-21:45:10-8bfe8bd5',
  ]);
  assertEquals(call?.endedAt, FAKE_NOW.toISOString());
});

Deno.test('calls-api › ended never overwrites an interaction id already stored', async () => {
  const { deps, state } = setup({
    calls: [fakeCall({ status: 'in_progress', interactionId: '20261102/first' })],
  });
  await handleCallsApi(
    post(`/v1/calls/${TOKEN}/ended`, { interactionId: '20261102/other', seconds: 10 }),
    deps,
  );
  assertEquals(state.calls[0]?.interactionId, '20261102/first');
});

Deno.test('calls-api › ended without an interaction id (call never connected) still completes', async () => {
  const { deps, state } = setup({ calls: [fakeCall()] });
  await handleCallsApi(post(`/v1/calls/${TOKEN}/ended`, { seconds: 0 }), deps);
  assertEquals([state.calls[0]?.status, state.calls[0]?.interactionId], ['completed', null]);
});

Deno.test('calls-api › ended: bad body → 400; an already-ended call → conflict', async () => {
  const { deps } = setup({ calls: [fakeCall({ status: 'completed' })] });
  const bad = await handleCallsApi(post(`/v1/calls/${TOKEN}/ended`, { seconds: -1 }), deps);
  assertEquals(bad.status, 400);
  const late = await handleCallsApi(post(`/v1/calls/${TOKEN}/ended`, { seconds: 3 }), deps);
  assertEquals(await errorCode(late), 'CALL_STATE_CONFLICT');
});

Deno.test('calls-api › the Sarvam URL route is the guarded proxy', async () => {
  const { deps, state } = setup({ calls: [fakeCall()] });
  const path = '/v1/sarvam/orgs/org-1/workspaces/ws-1/apps/app-1/url?interaction_type=call';
  const response = await handleCallsApi(
    request(path, { headers: { [CALL_TOKEN_HEADER]: TOKEN } }),
    deps,
  );
  assertEquals(await json(response), { url: 'wss://signed', reference_id: 'ref-1' });
  assertEquals(response.headers.get('access-control-allow-origin'), ORIGIN);
  assertEquals(state.calls[0]?.status, 'in_progress');
});

Deno.test('calls-api › a database failure → generic 500 with CORS headers', async () => {
  const { deps } = setup();
  const broken = {
    ...deps,
    repo: { ...deps.repo, getDemoSettings: () => Promise.reject(new Error('db')) },
  };
  const response = await handleCallsApi(request('/v1/demo'), broken);
  assertEquals(response.status, 500);
  assertEquals(response.headers.get('access-control-allow-origin'), ORIGIN);
});

Deno.test('calls-api › routes also match without the function prefix; bad escapes → 404', async () => {
  const { deps } = setup();
  const bare = await handleCallsApi(new Request('https://local.test/v1/demo'), deps);
  assertEquals(bare.status, 200);
  const malformed = await handleCallsApi(post('/v1/calls/%E0%A4%A/accept'), deps);
  assertEquals(malformed.status, 404);
});

Deno.test('calls-api › ended for an unknown token → 404', async () => {
  const { deps } = setup();
  const response = await handleCallsApi(
    post(`/v1/calls/${crypto.randomUUID()}/ended`, { seconds: 1 }),
    deps,
  );
  assertEquals(response.status, 404);
});

Deno.test('calls-api › ended: a real Sarvam id (with colons) is accepted; path tricks are not', async () => {
  const { deps } = setup({ calls: [fakeCall({ status: 'in_progress' })] });
  const tricky = { interactionId: '20261102/../../x', seconds: 5 };
  assertEquals((await handleCallsApi(post(`/v1/calls/${TOKEN}/ended`, tricky), deps)).status, 400);
});

Deno.test('calls-api › ended → follow-up queued and the worker woken', async () => {
  const { deps, state, kicked } = setup({ calls: [fakeCall({ status: 'in_progress' })] });
  await handleCallsApi(post(`/v1/calls/${TOKEN}/ended`, { seconds: 30 }), deps);
  assertEquals([state.calls[0]?.followupStatus, state.calls[0]?.followupNextAt], [
    'pending',
    FAKE_NOW.toISOString(),
  ]);
  assertEquals(kicked, [TOKEN]);
});

Deno.test('calls-api › declined → follow-up queued; a refused decline wakes nothing', async () => {
  const { deps, state, kicked } = setup({ calls: [ringingCall()] });
  await handleCallsApi(post(`/v1/calls/${TOKEN}/decline`), deps);
  assertEquals([state.calls[0]?.followupStatus, kicked], ['pending', [TOKEN]]);
  const accepted = setup({ calls: [fakeCall()] });
  await handleCallsApi(post(`/v1/calls/${TOKEN}/decline`), accepted.deps);
  assertEquals(accepted.kicked, []);
});

Deno.test('calls-api › missed → follow-up queued once', async () => {
  const { deps, state, kicked } = setup({ calls: [ringingCall({ ringingAt: SECONDS_AGO(31) })] });
  await handleCallsApi(request('/v1/phone/incoming'), deps);
  assertEquals([state.calls[0]?.status, state.calls[0]?.followupStatus], ['missed', 'pending']);
  assertEquals(kicked, [TOKEN]);
});

Deno.test('calls-api › an ended call that was already completed wakes nothing', async () => {
  const { deps, kicked } = setup({ calls: [fakeCall({ status: 'completed' })] });
  await handleCallsApi(post(`/v1/calls/${TOKEN}/ended`, { seconds: 3 }), deps);
  assertEquals(kicked, []);
});
