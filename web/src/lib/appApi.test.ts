// web/src/lib/appApi.test.ts
import { AppApiError, createAppApi, NETWORK_ERROR, UNEXPECTED_ERROR } from './appApi.ts';

const BASE = 'https://ref.supabase.co/functions/v1/calls-api';
const TOKEN = '11111111-1111-4111-8111-111111111111';

const ACCEPTED = {
  callToken: TOKEN,
  language: 'te',
  shopkeeperName: 'Ramesh',
  shopName: 'Ramesh Kirana',
  ownerName: 'Srinivas Reddy',
  businessName: 'Sri Lakshmi Traders',
  today: 'Monday, 2026-11-02',
  sarvam: { orgId: 'org', workspaceId: 'ws', appId: 'app' },
};

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

function setup(reply: () => Promise<Response>): {
  api: ReturnType<typeof createAppApi>;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  async function fetchImpl(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    sent.push({ url: String(input), init });
    return reply();
  }
  const api = createAppApi({ baseUrl: BASE, anonKey: 'anon', region: 'ap-south-1', fetchImpl });
  return { api, sent };
}

function json(body: unknown, status = 200): () => Promise<Response> {
  return async function reply() {
    return new Response(JSON.stringify(body), { status });
  };
}

describe('createAppApi', () => {
  it('sends the anon key and region on every request', async () => {
    const { api, sent } = setup(
      json({ liveShopkeeper: { name: 'Ramesh', shopName: 'Ramesh Kirana' } }),
    );
    await expect(api.getDemo()).resolves.toEqual({
      liveShopkeeper: { name: 'Ramesh', shopName: 'Ramesh Kirana' },
    });
    expect(sent[0]?.url).toBe(`${BASE}/v1/demo`);
    expect(sent[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer anon',
      apikey: 'anon',
      'x-region': 'ap-south-1',
    });
  });

  it('rings and reports whether a call was already waiting', async () => {
    const { api, sent } = setup(json({ status: 'queued', alreadyQueued: true }, 201));
    await expect(api.ring()).resolves.toEqual({ status: 'queued', alreadyQueued: true });
    expect(sent[0]?.init.method).toBe('POST');
  });

  it('wakes the tool server with an opaque GET and ignores failures', async () => {
    const { api, sent } = setup(async function failing() {
      throw new Error('offline');
    });
    expect(() => api.warmTools()).not.toThrow();
    await Promise.resolve();
    expect(sent[0]?.url).toBe('https://ref.supabase.co/functions/v1/sarvam-tools/warm');
    expect(sent[0]?.init.mode).toBe('no-cors');
  });

  it('returns the ringing call, or null when nothing rings', async () => {
    const ringing = setup(json({ call: { callToken: TOKEN, callerName: 'Sri Lakshmi Traders' } }));
    await expect(ringing.api.incoming()).resolves.toEqual({
      callToken: TOKEN,
      callerName: 'Sri Lakshmi Traders',
    });
    await expect(setup(json({ call: null })).api.incoming()).resolves.toBeNull();
  });

  it('accepts, declines and reports the end of a call by token', async () => {
    const { api, sent } = setup(json(ACCEPTED));
    await expect(api.accept(TOKEN)).resolves.toEqual(ACCEPTED);
    expect(sent[0]?.url).toBe(`${BASE}/v1/calls/${TOKEN}/accept`);
    const done = setup(json({ status: 'completed' }));
    await done.api.decline(TOKEN);
    await done.api.ended(TOKEN, { interactionId: 'abc/1', seconds: 61.6 });
    await done.api.ended(TOKEN, { interactionId: null, seconds: 99_999 });
    expect(done.sent.map((request) => request.url)).toEqual([
      `${BASE}/v1/calls/${TOKEN}/decline`,
      `${BASE}/v1/calls/${TOKEN}/ended`,
      `${BASE}/v1/calls/${TOKEN}/ended`,
    ]);
    expect(done.sent[1]?.init.body).toBe('{"seconds":62,"interactionId":"abc/1"}');
    expect(done.sent[2]?.init.body).toBe('{"seconds":3600}');
  });

  it('gives the Sarvam SDK our proxy URL and the call token header, never a Sarvam key', () => {
    const { api } = setup(json({}));
    const proxy = api.sarvamProxy(TOKEN);
    expect(proxy.baseUrl).toBe(`${BASE}/v1/sarvam/`);
    expect(proxy.headers).toEqual({
      Authorization: 'Bearer anon',
      apikey: 'anon',
      'x-region': 'ap-south-1',
      'x-call-token': TOKEN,
    });
  });

  it('turns a server error into its safe catalogue message and code', async () => {
    const error = {
      error: { code: 'CALL_STATE_CONFLICT', message: 'This call can no longer do that.' },
    };
    const { api } = setup(json(error, 409));
    await expect(api.accept(TOKEN)).rejects.toEqual(
      new AppApiError('This call can no longer do that.', 'CALL_STATE_CONFLICT'),
    );
  });

  it('uses generic messages for network failures and unexpected replies', async () => {
    const offline = setup(async function fail() {
      throw new TypeError('Failed to fetch');
    });
    await expect(offline.api.getDemo()).rejects.toThrow(NETWORK_ERROR);
    await expect(setup(json({ nope: true })).api.getDemo()).rejects.toThrow(UNEXPECTED_ERROR);
    await expect(setup(json('bad gateway', 502)).api.ring()).rejects.toThrow(UNEXPECTED_ERROR);
    const notJson = setup(async function html() {
      return new Response('<html>', { status: 200 });
    });
    await expect(notJson.api.getDemo()).rejects.toMatchObject({ code: null });
  });
});
