// supabase/functions/calls-api/sarvam-proxy.test.ts
import { assert, assertEquals } from '@std/assert';
import {
  createFakeRepository,
  FAKE_NOW,
  type FakeCall,
  fakeCall,
} from '../_shared/db/fake-repository.ts';
import type { LogFields, Logger } from '../_shared/log.ts';
import { CALL_TOKEN_HEADER, SARVAM_RUNTIME_URL } from '../_shared/sarvam.ts';
import {
  CALL_URL_WINDOW_MS,
  MAX_LIVE_SESSIONS_PER_DAY,
  proxyCallUrl,
  type ProxyDeps,
  type SarvamSettings,
} from './sarvam-proxy.ts';

const API_KEY = 'sarvam-agents-key-value';
const SARVAM: SarvamSettings = {
  apiKey: API_KEY,
  orgId: 'org-1',
  workspaceId: 'ws-1',
  appId: 'Asha-Easy-Recovery-1',
};
const SIGNED = {
  url: 'wss://apps.sarvam.ai/ws?sig=abc',
  reference_id: 'ref-1',
  expires_at: '2026-11-02T06:35:00Z',
};
const PATH_PARAMS = ['org-1', 'ws-1', 'Asha-Easy-Recovery-1'] as const;
const URL_PATH = 'https://ref.supabase.co/functions/v1/calls-api/v1/sarvam/orgs/org-1/workspaces/' +
  'ws-1/apps/Asha-Easy-Recovery-1/url?interaction_type=call&version=3&extra=drop';

interface Captured {
  url: string;
  headers: Headers;
}

interface Setup {
  readonly deps: ProxyDeps;
  readonly calls: () => readonly FakeCall[];
  readonly upstream: Captured[];
  readonly logs: LogFields[];
}

function setup(
  call: Partial<FakeCall> = {},
  options: {
    sarvam?: Partial<SarvamSettings>;
    upstream?: () => Promise<Response>;
    /** Earlier calls already in the table (for the daily cap). */
    earlier?: readonly FakeCall[];
  } = {},
): Setup {
  const calls = [fakeCall(call), ...(options.earlier ?? [])];
  const { repo, state } = createFakeRepository({ calls });
  const upstream: Captured[] = [];
  const logs: LogFields[] = [];
  const log: Logger = (_level, _event, fields = {}) => logs.push(fields);
  const respond = options.upstream ?? (() => Promise.resolve(Response.json(SIGNED)));
  const fetchImpl: typeof fetch = (input, init) => {
    upstream.push({ url: String(input), headers: new Headers(init?.headers) });
    return respond();
  };
  const sarvam = { ...SARVAM, ...options.sarvam };
  const deps: ProxyDeps = { repo, clock: () => FAKE_NOW, log, sarvam, fetchImpl };
  return { deps, calls: () => state.calls, upstream, logs };
}

function sdkRequest(token: string | null = fakeCall().callId): Request {
  const headers: Record<string, string> = { 'x-api-key': '' };
  if (token !== null) headers[CALL_TOKEN_HEADER] = token;
  return new Request(URL_PATH, { headers });
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

Deno.test('proxy › an accepted call gets the signed URL, passed through unchanged', async () => {
  const { deps, calls } = setup();
  const response = await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), SIGNED);
  assertEquals(calls()[0]?.status, 'in_progress');
  assertEquals(calls()[0]?.urlIssuedAt, FAKE_NOW.toISOString());
});

Deno.test('proxy › the key goes only to Sarvam, with the SDK query kept and extras dropped', async () => {
  const { deps, upstream } = setup();
  const response = await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS });
  assertEquals(upstream[0]?.headers.get('x-api-key'), API_KEY);
  assertEquals(
    upstream[0]?.url,
    `${SARVAM_RUNTIME_URL}orgs/org-1/workspaces/ws-1/apps/Asha-Easy-Recovery-1/url` +
      '?interaction_type=call&version=3',
  );
  assertEquals((await response.text()).includes(API_KEY), false);
});

Deno.test('proxy › no token, or a token that is not a call id → refused, Sarvam not asked', async () => {
  const { deps, upstream } = setup();
  assertEquals(
    await errorCode(await proxyCallUrl(sdkRequest(null), deps, { params: PATH_PARAMS })),
    'FORBIDDEN',
  );
  assertEquals(
    await errorCode(await proxyCallUrl(sdkRequest('nope'), deps, { params: PATH_PARAMS })),
    'FORBIDDEN',
  );
  assertEquals(upstream.length, 0);
});

Deno.test('proxy › an unknown token is refused', async () => {
  const { deps } = setup();
  const response = await proxyCallUrl(sdkRequest(crypto.randomUUID()), deps, {
    params: PATH_PARAMS,
  });
  assertEquals(response.status, 403);
});

Deno.test('proxy › a call not accepted on the phone (still ringing) is refused', async () => {
  const { deps, upstream } = setup({ status: 'ringing' });
  assertEquals((await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS })).status, 403);
  assertEquals(upstream.length, 0);
});

Deno.test('proxy › a second URL for the same token is refused', async () => {
  const { deps, upstream } = setup();
  await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS });
  const second = await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS });
  assertEquals(second.status, 403);
  assertEquals(upstream.length, 1);
});

Deno.test('proxy › a URL asked for too long after accepting is refused', async () => {
  const acceptedAt = new Date(FAKE_NOW.getTime() - CALL_URL_WINDOW_MS - 1).toISOString();
  const { deps } = setup({ acceptedAt });
  assertEquals((await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS })).status, 403);
});

Deno.test('proxy › an accepted call with no accept time is refused', async () => {
  const { deps } = setup({ acceptedAt: null });
  assertEquals((await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS })).status, 403);
});

Deno.test('proxy › another org, workspace or app is refused', async () => {
  const { deps, upstream } = setup();
  for (
    const params of [
      ['x', 'ws-1', 'Asha-Easy-Recovery-1'],
      ['org-1', 'x', 'Asha-Easy-Recovery-1'],
      ['org-1', 'ws-1', 'x'],
    ]
  ) {
    assertEquals((await proxyCallUrl(sdkRequest(), deps, { params: params })).status, 403);
  }
  assertEquals(upstream.length, 0);
});

Deno.test('proxy › no app id configured yet → "not set up", nothing changes', async () => {
  const { deps, calls } = setup({}, { sarvam: { appId: null } });
  const response = await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS });
  assertEquals(await errorCode(response), 'VOICE_NOT_CONFIGURED');
  assertEquals(calls()[0]?.status, 'accepted');
});

Deno.test('proxy › two requests racing for one token: only one URL', async () => {
  const { deps } = setup();
  const lost = { ...deps, repo: { ...deps.repo, transitionCall: () => Promise.resolve(false) } };
  assertEquals((await proxyCallUrl(sdkRequest(), lost, { params: PATH_PARAMS })).status, 403);
});

Deno.test('proxy › a Sarvam error becomes a safe error code; its body is not passed on', async () => {
  const upstream = (): Promise<Response> =>
    Promise.resolve(new Response('internal detail', { status: 500 }));
  const { deps, logs } = setup({}, { upstream });
  const response = await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS });
  assertEquals(response.status, 502);
  assertEquals((await response.text()).includes('internal detail'), false);
  assertEquals(logs.at(-1)?.['status'], 500);
});

Deno.test('proxy › a Sarvam reply without a URL is treated as an error', async () => {
  const upstream = (): Promise<Response> => Promise.resolve(Response.json({ nope: true }));
  const { deps } = setup({}, { upstream });
  assertEquals(
    await errorCode(await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS })),
    'UPSTREAM_ERROR',
  );
});

Deno.test('proxy › a Sarvam reply that is not JSON is treated as an error', async () => {
  const upstream = (): Promise<Response> => Promise.resolve(new Response('<html>'));
  const { deps } = setup({}, { upstream });
  assertEquals((await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS })).status, 502);
});

Deno.test('proxy › Sarvam not answering (timeout or network) → safe error, logged', async () => {
  const upstream = (): Promise<Response> =>
    Promise.reject(new DOMException('timed out', 'TimeoutError'));
  const { deps, logs } = setup({}, { upstream });
  const response = await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS });
  assertEquals(response.status, 502);
  assert(logs.some((fields) => fields['error'] === 'TimeoutError'));
});

Deno.test('proxy › a non-Error failure is logged as unknown', async () => {
  const upstream = (): Promise<Response> => Promise.reject('socket closed');
  const { deps, logs } = setup({}, { upstream });
  assertEquals((await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS })).status, 502);
  assertEquals(logs.at(-1)?.['error'], 'unknown');
});

// CP2 M3: an always-on daily cap on issued call URLs (billed Sarvam sessions), real clock, IST day.
function issuedCalls(count: number, urlIssuedAt: string): FakeCall[] {
  return Array.from(
    { length: count },
    () => fakeCall({ callId: crypto.randomUUID(), status: 'completed', urlIssuedAt }),
  );
}

const TODAY_IST_MIDNIGHT = '2026-11-01T18:30:00.000Z'; // 2026-11-02 00:00 IST

Deno.test('proxy › daily cap: the last URL under the cap is still issued', async () => {
  const earlier = issuedCalls(MAX_LIVE_SESSIONS_PER_DAY - 1, TODAY_IST_MIDNIGHT);
  const { deps, calls } = setup({}, { earlier });
  const response = await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS });
  assertEquals(response.status, 200);
  assertEquals(calls()[0]?.status, 'in_progress');
});

Deno.test('proxy › daily cap reached → RATE_LIMITED, Sarvam not asked, call unchanged', async () => {
  const earlier = issuedCalls(MAX_LIVE_SESSIONS_PER_DAY, TODAY_IST_MIDNIGHT);
  const { deps, calls, upstream, logs } = setup({}, { earlier });
  const response = await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS });
  assertEquals([response.status, await errorCode(response)], [429, 'RATE_LIMITED']);
  assertEquals([calls()[0]?.status, upstream.length], ['accepted', 0]);
  assertEquals(logs.at(-1)?.['reason'], 'daily_cap');
});

Deno.test('proxy › daily cap: URLs issued before IST midnight do not count', async () => {
  const yesterday = new Date(Date.parse(TODAY_IST_MIDNIGHT) - 1).toISOString();
  const { deps } = setup({}, { earlier: issuedCalls(MAX_LIVE_SESSIONS_PER_DAY, yesterday) });
  assertEquals((await proxyCallUrl(sdkRequest(), deps, { params: PATH_PARAMS })).status, 200);
});

Deno.test('proxy › daily cap cannot be switched off and ignores the demo clock', async () => {
  const earlier = issuedCalls(MAX_LIVE_SESSIONS_PER_DAY, TODAY_IST_MIDNIGHT);
  const { deps } = setup({}, { earlier });
  const settings = {
    demoClock: '2026-11-05T12:00:00+05:30',
    callingHoursEnabled: false,
    callLimitsEnabled: false,
    liveShopkeeperId: null,
  };
  const repo = { ...deps.repo, getDemoSettings: () => Promise.resolve(settings) };
  const response = await proxyCallUrl(sdkRequest(), { ...deps, repo }, { params: PATH_PARAMS });
  assertEquals(response.status, 429);
});

Deno.test('proxy › daily cap is 20 live sessions a day', () => {
  assertEquals(MAX_LIVE_SESSIONS_PER_DAY, 20);
});
