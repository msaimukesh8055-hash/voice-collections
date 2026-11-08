// supabase/functions/_shared/db/supabase-owner-call-repository.test.ts
// Checks the exact database requests and row mapping, with a fake fetch (no network).
import { assert, assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import type { OwnerCall } from './owner-call-repository.ts';
import { createPostgrestClient } from './postgrest.ts';
import { createSupabaseOwnerCallRepository } from './supabase-owner-call-repository.ts';

const ENV = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const OWNER_ID = '0e000000-0000-4000-8000-000000000001';
const CALL_ID = 'ca000000-0000-4000-8000-0000000000b1';

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly prefer: string | undefined;
  readonly body: Record<string, unknown> | null;
}

interface FakeReply {
  readonly status?: number;
  readonly body?: unknown;
  readonly contentRange?: string;
}

function setup(...replies: FakeReply[]): {
  repo: ReturnType<typeof createSupabaseOwnerCallRepository>;
  requests: Recorded[];
} {
  const requests: Recorded[] = [];
  const queue = [...replies];
  function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const headers = init?.headers as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      prefer: headers['Prefer'],
      body,
    });
    const reply = queue.shift() ?? {};
    const text = reply.body === undefined ? '' : JSON.stringify(reply.body);
    const responseHeaders = reply.contentRange
      ? { 'content-range': reply.contentRange }
      : undefined;
    return Promise.resolve(
      new Response(text === '' ? null : text, {
        status: reply.status ?? 200,
        headers: responseHeaders,
      }),
    );
  }
  const repo = createSupabaseOwnerCallRepository(createPostgrestClient(ENV, fakeFetch));
  return { repo, requests };
}

const ROW = {
  id: CALL_ID,
  owner_id: OWNER_ID,
  status: 'accepted',
  issued_at: '2026-11-02T06:28:00+00:00',
  expires_at: '2026-11-02T06:43:00+00:00',
  accepted_at: '2026-11-02T06:29:00+00:00',
  url_issued_at: null,
};

const MAPPED: OwnerCall = {
  id: CALL_ID,
  ownerId: OWNER_ID,
  status: 'accepted',
  issuedAt: '2026-11-02T06:28:00+00:00',
  expiresAt: '2026-11-02T06:43:00+00:00',
  acceptedAt: '2026-11-02T06:29:00+00:00',
  urlIssuedAt: null,
};

Deno.test('owner calls › createOwnerCall posts the owner and expiry and maps the row', async () => {
  const { repo, requests } = setup({ status: 201, body: [{ ...ROW, status: 'issued' }] });
  const created = await repo.createOwnerCall({
    ownerId: OWNER_ID,
    expiresAt: '2026-11-02T06:43:00.000Z',
  });
  assertEquals(created, { ...MAPPED, status: 'issued' });
  assertEquals(requests[0]?.method, 'POST');
  assertEquals(requests[0]?.prefer, 'return=representation');
  assertEquals(requests[0]?.body, { owner_id: OWNER_ID, expires_at: '2026-11-02T06:43:00.000Z' });
  assertStringIncludes(requests[0]?.url ?? '', '/rest/v1/owner_calls?select=id,owner_id');
});

Deno.test('owner calls › createOwnerCall with no row back is an error', async () => {
  const { repo } = setup({ status: 201, body: [] });
  await assertRejects(
    () => repo.createOwnerCall({ ownerId: OWNER_ID, expiresAt: '2026-11-02T06:43:00Z' }),
    Error,
    'no row',
  );
});

Deno.test('owner calls › getOwnerCall reads one row by id, or null', async () => {
  const { repo, requests } = setup({ body: [ROW] }, { body: [] });
  assertEquals(await repo.getOwnerCall(CALL_ID), MAPPED);
  assertEquals(await repo.getOwnerCall(CALL_ID), null);
  assertStringIncludes(requests[0]?.url ?? '', `id=eq.${CALL_ID}`);
});

Deno.test('owner calls › a row with an unknown status is rejected', async () => {
  const { repo } = setup({ body: [{ ...ROW, status: 'ringing' }] });
  await assertRejects(() => repo.getOwnerCall(CALL_ID));
});

Deno.test('owner calls › transitionOwnerCall is compare-and-set on the expected statuses', async () => {
  const { repo, requests } = setup({ body: [{ id: CALL_ID }] }, { body: [] });
  const patch = {
    status: 'completed' as const,
    endedAt: '2026-11-02T06:35:00.000Z',
    durationSeconds: 300,
    interactionId: 'int-1',
  };
  assertEquals(await repo.transitionOwnerCall(CALL_ID, ['accepted', 'in_progress'], patch), true);
  assertEquals(await repo.transitionOwnerCall(CALL_ID, ['accepted'], { status: 'expired' }), false);
  assertEquals(requests[0]?.method, 'PATCH');
  assertStringIncludes(requests[0]?.url ?? '', 'status=in.(accepted,in_progress)');
  assertEquals(requests[0]?.body, {
    status: 'completed',
    ended_at: '2026-11-02T06:35:00.000Z',
    duration_seconds: 300,
    interaction_id: 'int-1',
  });
  assertEquals(requests[1]?.body, { status: 'expired' });
});

Deno.test('owner calls › transition sends accepted_at and url_issued_at when set', async () => {
  const { repo, requests } = setup({ body: [{ id: CALL_ID }] });
  await repo.transitionOwnerCall(CALL_ID, ['issued'], {
    status: 'accepted',
    acceptedAt: '2026-11-02T06:29:00.000Z',
    urlIssuedAt: '2026-11-02T06:29:05.000Z',
  });
  assertEquals(requests[0]?.body, {
    status: 'accepted',
    accepted_at: '2026-11-02T06:29:00.000Z',
    url_issued_at: '2026-11-02T06:29:05.000Z',
  });
});

Deno.test("owner calls › expireIssuedOwnerCalls expires only this owner's issued links", async () => {
  const { repo, requests } = setup({ status: 204 });
  await repo.expireIssuedOwnerCalls(OWNER_ID);
  assertEquals(requests[0]?.method, 'PATCH');
  assertEquals(requests[0]?.body, { status: 'expired' });
  assertStringIncludes(requests[0]?.url ?? '', `owner_id=eq.${OWNER_ID}&status=eq.issued`);
});

Deno.test('owner calls › the counts use HEAD + count=exact and read the total', async () => {
  const since = new Date('2026-11-02T06:20:00.000Z');
  const { repo, requests } = setup({ contentRange: '*/2' }, { contentRange: '0-5/6' });
  assertEquals(await repo.countOwnerCallsIssuedSince(OWNER_ID, since), 2);
  assertEquals(await repo.countOwnerUrlsIssuedSince(since), 6);
  for (const request of requests) {
    assertEquals([request.method, request.prefer], ['HEAD', 'count=exact']);
  }
  assertStringIncludes(requests[0]?.url ?? '', `owner_id=eq.${OWNER_ID}&issued_at=gte.`);
  assertStringIncludes(requests[1]?.url ?? '', 'url_issued_at=gte.');
});

Deno.test('owner calls › a count with no total is an error', async () => {
  const { repo } = setup({}, {});
  await assertRejects(() => repo.countOwnerUrlsIssuedSince(new Date()), Error, 'no count');
  await assertRejects(
    () => repo.countOwnerCallsIssuedSince(OWNER_ID, new Date()),
    Error,
    'no count',
  );
});

Deno.test('owner calls › hasActiveOwnerCall looks for one accepted or talking call', async () => {
  const { repo, requests } = setup({ body: [{ id: CALL_ID }] }, { body: [] });
  const since = new Date('2026-11-02T06:20:00.000Z');
  assertEquals(await repo.hasActiveOwnerCall(since), true);
  assertEquals(await repo.hasActiveOwnerCall(since), false);
  const url = requests[0]?.url ?? '';
  assertStringIncludes(url, 'status=in.(accepted,in_progress)');
  assertStringIncludes(url, 'accepted_at=gte.');
  assert(url.endsWith('&limit=1'));
});

Deno.test('owner calls › insertOwnerToolEvent writes the audit row', async () => {
  const { repo, requests } = setup({ status: 201 });
  await repo.insertOwnerToolEvent({
    ownerCallId: CALL_ID,
    tool: 'book_summary',
    args: { focus: 'overview' },
    result: { ok: true, say: 'x', data: {} },
    durationMs: 12,
  });
  assertEquals(requests[0]?.method, 'POST');
  assertEquals(requests[0]?.prefer, 'return=minimal');
  assertEquals(requests[0]?.body, {
    owner_call_id: CALL_ID,
    tool: 'book_summary',
    args: { focus: 'overview' },
    result: { ok: true, say: 'x', data: {} },
    duration_ms: 12,
  });
  assertStringIncludes(requests[0]?.url ?? '', '/rest/v1/owner_tool_events');
});
