// web/src/lib/dashboardApi.test.ts
// The dashboard client (M6): the link token's journey, the headers sent, and the replies.
import { createDashboardApi, NeedsLinkError, readToken } from './dashboardApi.ts';
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
