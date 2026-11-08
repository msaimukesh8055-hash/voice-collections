// supabase/functions/calls-api/sarvam-proxy-munshi.test.ts
// M8 A3 (security, 100%): the proxy's Munshi branch. Munshi's app id takes only a signed owner
// call token, accepted under 2 minutes ago, once; Asha's app id never takes an owner token, and
// Munshi's never takes a shopkeeper call token. The daily cap counts both tables, with at most 6
// Munshi sessions inside it. Fakes only.
import { assertEquals } from '@std/assert';
import { signOwnerCallToken } from '../_shared/auth/owner-call-link.ts';
import { MAX_MUNSHI_SESSIONS_PER_DAY } from '../_shared/calls/owner-call-limits.ts';
import {
  createFakeRepository,
  FAKE_NOW,
  type FakeCall,
  fakeCall,
} from '../_shared/db/fake-repository.ts';
import { type FakeOwnerCall, fakeOwnerCall } from '../_shared/db/fake-owner-call-repository.ts';
import type { LogFields, Logger } from '../_shared/log.ts';
import { CALL_TOKEN_HEADER } from '../_shared/sarvam.ts';
import { MUNSHI_LINK_SECRET, munshiSetup } from './__fixtures__/munshi.ts';
import {
  CALL_URL_WINDOW_MS,
  MAX_LIVE_SESSIONS_PER_DAY,
  proxyCallUrl,
  type ProxyDeps,
} from './sarvam-proxy.ts';

const ASHA_APP = 'Asha-Easy-Recovery-1';
const MUNSHI_APP = 'Munshi-Easy-Recovery-1';
const ASHA_PARAMS = ['org-1', 'ws-1', ASHA_APP] as const;
const MUNSHI_PARAMS = ['org-1', 'ws-1', MUNSHI_APP] as const;
const OWNER_CALL_ID = fakeOwnerCall().id;
const SHOPKEEPER_CALL_ID = fakeCall().callId;
const TODAY_IST_MIDNIGHT = '2026-11-01T18:30:00.000Z';
const SIGNED = { url: 'wss://apps.sarvam.ai/ws?sig=abc', reference_id: 'ref-1' };

interface Setup {
  readonly deps: ProxyDeps;
  readonly ownerCalls: () => readonly FakeOwnerCall[];
  readonly calls: () => readonly FakeCall[];
  readonly upstream: string[];
  readonly logs: LogFields[];
}

function setup(
  options: {
    ownerCalls?: readonly FakeOwnerCall[];
    calls?: readonly FakeCall[];
    linkSecret?: string | null;
    munshiAppId?: string | null;
    appId?: string | null;
  } = {},
): Setup {
  const { repo, state } = createFakeRepository({ calls: options.calls ?? [fakeCall()] });
  const owner = munshiSetup({
    ownerCalls: { ownerCalls: options.ownerCalls ?? [fakeOwnerCall()] },
    ...(options.linkSecret === undefined ? {} : { linkSecret: options.linkSecret }),
  });
  const upstream: string[] = [];
  const logs: LogFields[] = [];
  const log: Logger = (_level, _event, fields = {}) => logs.push(fields);
  const deps: ProxyDeps = {
    repo,
    clock: () => FAKE_NOW,
    log,
    sarvam: {
      apiKey: 'agents-key',
      orgId: 'org-1',
      workspaceId: 'ws-1',
      appId: options.appId === undefined ? ASHA_APP : options.appId,
      munshiAppId: options.munshiAppId === undefined ? MUNSHI_APP : options.munshiAppId,
    },
    fetchImpl: (input) => {
      upstream.push(String(input));
      return Promise.resolve(Response.json(SIGNED));
    },
    munshi: owner.munshi,
  };
  return {
    deps,
    ownerCalls: () => owner.state.ownerCalls,
    calls: () => state.calls,
    upstream,
    logs,
  };
}

function sdkRequest(token: string | null): Request {
  const headers: Record<string, string> = { 'x-api-key': '' };
  if (token !== null) headers[CALL_TOKEN_HEADER] = token;
  return new Request('https://ref.supabase.co/functions/v1/calls-api/v1/sarvam/url', { headers });
}

function ownerToken(id = OWNER_CALL_ID): Promise<string> {
  return signOwnerCallToken(MUNSHI_LINK_SECRET, id);
}

function ask(s: Setup, token: string | null, params: readonly string[]): Promise<Response> {
  return proxyCallUrl(sdkRequest(token), s.deps, { params });
}

function used(count: number, at = TODAY_IST_MIDNIGHT): FakeOwnerCall[] {
  return Array.from(
    { length: count },
    () => fakeOwnerCall({ id: crypto.randomUUID(), status: 'completed', urlIssuedAt: at }),
  );
}

function usedCalls(count: number): FakeCall[] {
  return Array.from(
    { length: count },
    () =>
      fakeCall({
        callId: crypto.randomUUID(),
        status: 'completed',
        urlIssuedAt: TODAY_IST_MIDNIGHT,
      }),
  );
}

Deno.test("proxy munshi › an accepted owner call gets one URL, for Munshi's app id", async () => {
  const s = setup();
  const response = await ask(s, await ownerToken(), MUNSHI_PARAMS);
  assertEquals([response.status, await response.json()], [200, SIGNED]);
  assertEquals(s.ownerCalls()[0]?.status, 'in_progress');
  assertEquals(s.ownerCalls()[0]?.urlIssuedAt, FAKE_NOW.toISOString());
  assertEquals(s.upstream[0]?.includes(`/apps/${MUNSHI_APP}/url`), true);
  assertEquals((await ask(s, await ownerToken(), MUNSHI_PARAMS)).status, 403);
  assertEquals(s.upstream.length, 1);
});

Deno.test("proxy munshi › Asha's call token on Munshi's app id → refused", async () => {
  const s = setup();
  assertEquals((await ask(s, SHOPKEEPER_CALL_ID, MUNSHI_PARAMS)).status, 403);
  assertEquals([s.calls()[0]?.status, s.upstream.length], ['accepted', 0]);
});

Deno.test("proxy munshi › an owner token on Asha's app id → refused", async () => {
  const s = setup();
  assertEquals((await ask(s, await ownerToken(), ASHA_PARAMS)).status, 403);
  assertEquals((await ask(s, OWNER_CALL_ID, ASHA_PARAMS)).status, 403);
  assertEquals([s.ownerCalls()[0]?.status, s.upstream.length], ['accepted', 0]);
});

Deno.test('proxy munshi › tampered, unknown or missing tokens; no link secret → refused', async () => {
  const s = setup();
  const tampered = `${(await ownerToken()).slice(0, -1)}x`;
  for (const token of [null, tampered, OWNER_CALL_ID, await ownerToken(crypto.randomUUID())]) {
    assertEquals((await ask(s, token, MUNSHI_PARAMS)).status, 403);
  }
  const noSecret = setup({ linkSecret: null });
  assertEquals((await ask(noSecret, await ownerToken(), MUNSHI_PARAMS)).status, 403);
  assertEquals(s.upstream.length + noSecret.upstream.length, 0);
});

Deno.test('proxy munshi › only an accepted owner call, within 2 minutes of Start call', async () => {
  const stale = new Date(FAKE_NOW.getTime() - CALL_URL_WINDOW_MS - 1).toISOString();
  for (
    const row of [
      fakeOwnerCall({ status: 'issued', acceptedAt: null }),
      fakeOwnerCall({ status: 'completed' }),
      fakeOwnerCall({ status: 'accepted', acceptedAt: null }),
      fakeOwnerCall({ acceptedAt: stale }),
    ]
  ) {
    const s = setup({ ownerCalls: [row] });
    assertEquals((await ask(s, await ownerToken(), MUNSHI_PARAMS)).status, 403, row.status);
    assertEquals(s.ownerCalls()[0]?.status, row.status);
  }
});

Deno.test('proxy munshi › two requests racing for one owner call: only one URL', async () => {
  const s = setup();
  const lost: ProxyDeps = {
    ...s.deps,
    munshi: {
      ...s.deps.munshi,
      ownerCalls: {
        ...s.deps.munshi.ownerCalls,
        transitionOwnerCall: () => Promise.resolve(false),
      },
    },
  };
  const response = await proxyCallUrl(sdkRequest(await ownerToken()), lost, {
    params: MUNSHI_PARAMS,
  });
  assertEquals(response.status, 403);
});

Deno.test('proxy munshi › the 7th Munshi session of the day → RATE_LIMITED', async () => {
  const atCap = setup({ ownerCalls: [fakeOwnerCall(), ...used(MAX_MUNSHI_SESSIONS_PER_DAY)] });
  const refused = await ask(atCap, await ownerToken(), MUNSHI_PARAMS);
  assertEquals(refused.status, 429);
  assertEquals(atCap.logs.at(-1), { reason: 'daily_cap', target: 'munshi' });
  const under = setup({ ownerCalls: [fakeOwnerCall(), ...used(MAX_MUNSHI_SESSIONS_PER_DAY - 1)] });
  assertEquals((await ask(under, await ownerToken(), MUNSHI_PARAMS)).status, 200);
  const yesterday = new Date(Date.parse(TODAY_IST_MIDNIGHT) - 1).toISOString();
  const old = setup({
    ownerCalls: [fakeOwnerCall(), ...used(MAX_MUNSHI_SESSIONS_PER_DAY, yesterday)],
  });
  assertEquals((await ask(old, await ownerToken(), MUNSHI_PARAMS)).status, 200);
});

Deno.test('proxy munshi › the shared cap of 20 counts Asha and Munshi sessions together', async () => {
  const asha = MAX_LIVE_SESSIONS_PER_DAY - 2;
  const forMunshi = setup({
    calls: usedCalls(asha),
    ownerCalls: [fakeOwnerCall(), ...used(2)],
  });
  assertEquals((await ask(forMunshi, await ownerToken(), MUNSHI_PARAMS)).status, 429);
  const forAsha = setup({
    calls: [fakeCall(), ...usedCalls(asha)],
    ownerCalls: used(2),
  });
  assertEquals((await ask(forAsha, SHOPKEEPER_CALL_ID, ASHA_PARAMS)).status, 429);
  const roomLeft = setup({ calls: [fakeCall(), ...usedCalls(asha)], ownerCalls: used(1) });
  assertEquals((await ask(roomLeft, SHOPKEEPER_CALL_ID, ASHA_PARAMS)).status, 200);
});

Deno.test('proxy munshi › only Munshi set up: Asha is refused, Munshi works; unknown app → bad target', async () => {
  const s = setup({ appId: null });
  assertEquals((await ask(s, SHOPKEEPER_CALL_ID, ASHA_PARAMS)).status, 403);
  assertEquals(s.logs.at(-1), { reason: 'bad_target', target: null });
  assertEquals((await ask(s, await ownerToken(), MUNSHI_PARAMS)).status, 200);
  const none = setup({ munshiAppId: null });
  assertEquals((await ask(none, await ownerToken(), MUNSHI_PARAMS)).status, 403);
  const missingApp = setup();
  assertEquals((await ask(missingApp, await ownerToken(), ['org-1', 'ws-1'])).status, 403);
});

Deno.test('proxy munshi › neither agent set up → VOICE_NOT_CONFIGURED', async () => {
  const s = setup({ appId: null, munshiAppId: null });
  const response = await ask(s, await ownerToken(), MUNSHI_PARAMS);
  assertEquals(response.status, 503);
});
