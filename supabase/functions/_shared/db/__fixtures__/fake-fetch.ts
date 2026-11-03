// supabase/functions/_shared/db/__fixtures__/fake-fetch.ts
// A fake fetch for database request-shape tests: records every request and answers from a queue.

export interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

export interface FakeReply {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export function fakeFetchFor(replies: readonly FakeReply[]): {
  readonly fetchImpl: typeof fetch;
  readonly requests: Recorded[];
} {
  const requests: Recorded[] = [];
  const queue = [...replies];
  function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: init?.headers as Record<string, string>,
      body: (init?.body as string | null) ?? null,
    });
    const reply = queue.shift() ?? {};
    const text = reply.body === undefined ? '' : JSON.stringify(reply.body);
    return Promise.resolve(
      new Response(text, { status: reply.status ?? 200, headers: reply.headers ?? {} }),
    );
  }
  return { fetchImpl: fakeFetch, requests };
}
