// web/src/lib/dashboardApi.test.ts
// The dashboard client (M6): the link token's journey, the headers sent, and the replies.
import {
  addressWithoutToken,
  createDashboardApi,
  fetchDevToken,
  NeedsLinkError,
  readToken,
} from './dashboardApi.ts';
import { OVERVIEW } from '../test/dashboardFakes.ts';
import { AppApiError } from './appApi.ts';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('readToken', () => {
  it('takes the token from the link, stores it for the tab and clears the address bar', () => {
    const storage = memoryStorage();
    const clearHash = vi.fn();
    expect(readToken({ hash: '#t=123.abc', storage, clearHash })).toBe('123.abc');
    expect(storage.data.get('dashboardToken')).toBe('123.abc');
    expect(clearHash).toHaveBeenCalledOnce();
  });

  it('falls back to the stored token on later pages', () => {
    const storage = memoryStorage();
    storage.setItem('dashboardToken', 'saved');
    expect(readToken({ hash: '', storage, clearHash: vi.fn() })).toBe('saved');
  });

  it('works without storage (private mode) and returns null when there is nothing', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readToken({ hash: '#t=x.y', storage: broken, clearHash: vi.fn() })).toBe('x.y');
    expect(readToken({ hash: '', storage: broken, clearHash: vi.fn() })).toBeNull();
    expect(readToken({ hash: '', storage: null, clearHash: vi.fn() })).toBeNull();
  });
});

describe('a call link from the WhatsApp summary (dry-run fix 8)', () => {
  const CALL = 'ca000000-0000-4000-8000-000000000001';

  it('keeps the token from /calls?id=…#t=… and stays on that call once the token is cleared', () => {
    const storage = memoryStorage();
    const replaced: string[] = [];
    const location = { pathname: '/calls', search: `?id=${CALL}`, hash: '#t=1793872800.sig' };
    function clearHash(): void {
      replaced.push(addressWithoutToken(location));
    }
    expect(readToken({ hash: location.hash, storage, clearHash })).toBe('1793872800.sig');
    expect(storage.data.get('dashboardToken')).toBe('1793872800.sig');
    expect(replaced).toEqual([`/calls?id=${CALL}`]);
  });

  it('a later page in the same tab still has the token', () => {
    const storage = memoryStorage();
    readToken({ hash: '#t=tok.en', storage, clearHash: vi.fn() });
    expect(readToken({ hash: '', storage, clearHash: vi.fn() })).toBe('tok.en');
  });
});

describe('createDashboardApi', () => {
  const base = { baseUrl: 'https://x/calls-api', anonKey: 'anon', region: 'ap-south-1' };

  it('sends the token header and parses the overview', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json(OVERVIEW)));
    const api = createDashboardApi({ ...base, token: 'T', fetchImpl });
    expect((await api.overview()).insights.percentCollected).toBe(30);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x/calls-api/v1/dashboard/overview');
    expect((init.headers as Record<string, string>)['x-dashboard-token']).toBe('T');
  });

  it('no token or a 401 means "open the link from WhatsApp"', async () => {
    const none = createDashboardApi({ ...base, token: null, fetchImpl: vi.fn() });
    expect(none.hasToken()).toBe(false);
    await expect(none.overview()).rejects.toBeInstanceOf(NeedsLinkError);
    const expired = createDashboardApi({
      ...base,
      token: 'old',
      fetchImpl: () => Promise.resolve(new Response('{}', { status: 401 })),
    });
    await expect(expired.calls()).rejects.toBeInstanceOf(NeedsLinkError);
  });

  it('other failures become safe messages', async () => {
    const down = createDashboardApi({
      ...base,
      token: 'T',
      fetchImpl: () => Promise.reject(new Error('offline')),
    });
    await expect(down.shopkeepers()).rejects.toBeInstanceOf(AppApiError);
    const odd = createDashboardApi({
      ...base,
      token: 'T',
      fetchImpl: () => Promise.resolve(Response.json({ nope: true })),
    });
    await expect(odd.shopkeeper('a')).rejects.toThrow('unexpected reply');
    const known = createDashboardApi({
      ...base,
      token: 'T',
      fetchImpl: () =>
        Promise.resolve(
          Response.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, { status: 404 }),
        ),
    });
    await expect(known.call('x')).rejects.toThrow('Not found.');
    const garbled = createDashboardApi({
      ...base,
      token: 'T',
      fetchImpl: () => Promise.resolve(new Response('oops', { status: 500 })),
    });
    await expect(garbled.call('x')).rejects.toThrow('unexpected reply');
  });

  it('changes the English-under-Telugu setting with a POST', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(Response.json({ settings: { englishUnderTelugu: false } })),
    );
    const api = createDashboardApi({ ...base, token: 'T', fetchImpl });
    expect(await api.setEnglishUnderTelugu(false)).toBe(false);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"englishUnderTelugu":false}');
  });
});

describe('localhost dev token (npm run dev only)', () => {
  const base = { baseUrl: 'https://x/calls-api', anonKey: 'anon', region: 'ap-south-1' };

  it('fetchDevToken reads the token, or null on 404, a network error or a bad reply', async () => {
    const ok = vi.fn(() => Promise.resolve(Response.json({ token: 'DEV' })));
    expect(await fetchDevToken(ok)).toBe('DEV');
    expect(ok).toHaveBeenCalledWith('/__dev/dashboard-token');
    expect(await fetchDevToken(() => Promise.resolve(new Response('', { status: 404 })))).toBe(
      null,
    );
    expect(await fetchDevToken(() => Promise.reject(new Error('down')))).toBe(null);
    expect(await fetchDevToken(() => Promise.resolve(Response.json({ token: '' })))).toBe(null);
  });

  it('with no link token, fetches the dev token once and sends it on every read', async () => {
    const devToken = vi.fn(() => Promise.resolve('DEV'));
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json(OVERVIEW)));
    const api = createDashboardApi({ ...base, token: null, devToken, fetchImpl });
    await Promise.all([api.overview(), api.overview()]);
    expect(devToken).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-dashboard-token']).toBe('DEV');
    expect(await api.localDemo()).toBe(true);
    expect(api.hasToken()).toBe(true);
  });

  it('a link token wins: the dev token is never asked for', async () => {
    const devToken = vi.fn(() => Promise.resolve('DEV'));
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json(OVERVIEW)));
    const api = createDashboardApi({ ...base, token: 'LINK', devToken, fetchImpl });
    await api.overview();
    expect(devToken).not.toHaveBeenCalled();
    expect(await api.localDemo()).toBe(false);
  });

  it('a refused link token (expired or left in storage) falls back to the dev token once', async () => {
    const devToken = vi.fn(() => Promise.resolve('DEV'));
    function linkRefused(_url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const sent = (init?.headers as Record<string, string>)['x-dashboard-token'];
      return Promise.resolve(
        sent === 'DEV' ? Response.json(OVERVIEW) : new Response('{}', { status: 401 }),
      );
    }
    const fetchImpl = vi.fn(linkRefused);
    const api = createDashboardApi({ ...base, token: 'OLD', devToken, fetchImpl });
    expect((await api.overview()).insights.percentCollected).toBe(30);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await api.localDemo()).toBe(true);
    await api.overview();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(devToken).toHaveBeenCalledOnce();
  });

  it('several reads refused with the old link at once all retry with the dev token', async () => {
    function linkRefused(_url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const sent = (init?.headers as Record<string, string>)['x-dashboard-token'];
      return Promise.resolve(
        sent === 'DEV' ? Response.json(OVERVIEW) : new Response('{}', { status: 401 }),
      );
    }
    const api = createDashboardApi({
      ...base,
      token: 'OLD',
      devToken: () => Promise.resolve('DEV'),
      fetchImpl: vi.fn(linkRefused),
    });
    const results = await Promise.all([api.overview(), api.overview(), api.overview()]);
    expect(results.map((overview) => overview.insights.percentCollected)).toEqual([30, 30, 30]);
  });

  it('if the dev token is refused too, no endless retry: "open the link from WhatsApp"', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{}', { status: 401 })));
    const api = createDashboardApi({
      ...base,
      token: 'OLD',
      devToken: () => Promise.resolve('DEV'),
      fetchImpl,
    });
    await expect(api.overview()).rejects.toBeInstanceOf(NeedsLinkError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('no dev token (404 or production) still means "open the link from WhatsApp"', async () => {
    const api = createDashboardApi({
      ...base,
      token: null,
      devToken: () => Promise.resolve(null),
      fetchImpl: vi.fn(),
    });
    await expect(api.overview()).rejects.toBeInstanceOf(NeedsLinkError);
    expect(await api.localDemo()).toBe(false);
  });
});
