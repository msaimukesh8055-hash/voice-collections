// web/src/lib/callsApi.test.ts
import { createCallsApi, CallsApiError } from './callsApi.ts';

const BASE = 'https://ref.supabase.co/functions/v1/calls-api';
const ANITA = {
  id: 'c0000000-0000-4000-8000-000000000002',
  fullName: 'Anita Desai',
  language: 'en',
  city: 'Mumbai',
};
const TOKEN = 'ca000000-0000-4000-8000-0000000000aa';

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function fakeFetch(
  status: number,
  body: unknown,
): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  async function fetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status });
  }
  return { fetchImpl, requests };
}

describe('createCallsApi', () => {
  it('lists customers with the anon key in the headers', async () => {
    const { fetchImpl, requests } = fakeFetch(200, { customers: [ANITA] });
    const api = createCallsApi({ baseUrl: BASE, anonKey: 'anon', fetchImpl, retryDelayMs: 0 });
    expect(await api.listCustomers()).toEqual([ANITA]);
    expect(requests[0]?.url).toBe(`${BASE}/v1/customers`);
    expect(requests[0]?.init?.headers).toMatchObject({
      Authorization: 'Bearer anon',
      apikey: 'anon',
    });
  });

  it('pins the function region when one is configured', async () => {
    const { fetchImpl, requests } = fakeFetch(200, { customers: [] });
    const options = { baseUrl: BASE, anonKey: 'anon', region: 'us-west-2', fetchImpl };
    await createCallsApi(options).listCustomers();
    expect(requests[0]?.init?.headers).toMatchObject({ 'x-region': 'us-west-2' });
  });

  it('throws a typed error when the customer list fails', async () => {
    const { fetchImpl } = fakeFetch(500, { error: { code: 'INTERNAL', message: 'x' } });
    const api = createCallsApi({ baseUrl: BASE, anonKey: 'anon', fetchImpl, retryDelayMs: 0 });
    await expect(api.listCustomers()).rejects.toThrow(CallsApiError);
  });

  it('returns the call token, name, language and today when authorised', async () => {
    const call = {
      callToken: TOKEN,
      customerName: 'Anita Desai',
      language: 'en',
      today: 'Sunday, 2026-11-01',
    };
    const { fetchImpl, requests } = fakeFetch(201, call);
    const api = createCallsApi({ baseUrl: BASE, anonKey: 'anon', fetchImpl, retryDelayMs: 0 });
    expect(await api.authoriseCall(ANITA.id)).toEqual({ ok: true, call });
    expect(requests[0]?.init?.method).toBe('POST');
    expect(requests[0]?.init?.body).toBe(JSON.stringify({ customerId: ANITA.id }));
  });

  it('returns the server reason when the call is blocked', async () => {
    const message = 'Calls are only allowed between 08:00 and 19:00 IST.';
    const { fetchImpl } = fakeFetch(409, { error: { code: 'OUTSIDE_CALLING_HOURS', message } });
    const api = createCallsApi({ baseUrl: BASE, anonKey: 'anon', fetchImpl, retryDelayMs: 0 });
    expect(await api.authoriseCall(ANITA.id)).toEqual({ ok: false, message });
  });

  it('throws when an error response has an unexpected shape', async () => {
    const { fetchImpl } = fakeFetch(502, { oops: true });
    const api = createCallsApi({ baseUrl: BASE, anonKey: 'anon', fetchImpl, retryDelayMs: 0 });
    await expect(api.authoriseCall(ANITA.id)).rejects.toThrow('Authorise failed (502)');
  });
});

describe('createCallsApi › customer list retries', () => {
  it('recovers when the first attempt drops the connection', async () => {
    let calls = 0;
    async function flakyFetch(): Promise<Response> {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ customers: [ANITA] }), { status: 200 });
    }
    const api = createCallsApi({
      baseUrl: BASE,
      anonKey: 'anon',
      fetchImpl: flakyFetch,
      retryDelayMs: 0,
    });
    expect(await api.listCustomers()).toEqual([ANITA]);
    expect(calls).toBe(2);
  });

  it('gives up after 3 attempts', async () => {
    const { fetchImpl, requests } = fakeFetch(503, {});
    const api = createCallsApi({ baseUrl: BASE, anonKey: 'anon', fetchImpl, retryDelayMs: 0 });
    await expect(api.listCustomers()).rejects.toThrow(CallsApiError);
    expect(requests).toHaveLength(3);
  });

  it('never retries authorising a call (it creates a call record)', async () => {
    const { fetchImpl, requests } = fakeFetch(502, { oops: true });
    const api = createCallsApi({ baseUrl: BASE, anonKey: 'anon', fetchImpl, retryDelayMs: 0 });
    await expect(api.authoriseCall(ANITA.id)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
});
