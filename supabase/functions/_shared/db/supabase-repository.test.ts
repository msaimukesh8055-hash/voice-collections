// supabase/functions/_shared/db/supabase-repository.test.ts
// Checks the exact database requests and the row mapping, with a fake fetch (no network).
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { createPostgrestClient, RepositoryError } from './postgrest.ts';
import { createSupabaseRepository } from './supabase-repository.ts';

const ENV = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const CALL_ID = 'ca000000-0000-4000-8000-0000000000aa';
const SHOPKEEPER_ID = '5e000000-0000-4000-8000-000000000001';

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

interface FakeReply {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

function setup(
  ...replies: FakeReply[]
): { repo: ReturnType<typeof createSupabaseRepository>; requests: Recorded[] } {
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
  return { repo: createSupabaseRepository(createPostgrestClient(ENV, fakeFetch)), requests };
}

const SESSION_ROW = {
  id: CALL_ID,
  shopkeeper_id: SHOPKEEPER_ID,
  mode: 'live',
  status: 'accepted',
  language: 'te',
  identity_status: 'unknown',
  identity_unsure_count: 0,
  interaction_id: null,
  queued_at: '2026-11-02T06:28:00Z',
  ringing_at: '2026-11-02T06:28:30Z',
  accepted_at: '2026-11-02T06:29:00Z',
  url_issued_at: null,
};

Deno.test('postgrest › sends the service key and maps the call session', async () => {
  const { repo, requests } = setup({ body: [SESSION_ROW] });
  const session = await repo.getCallSession(CALL_ID);
  assertEquals([session?.shopkeeperId, session?.status, session?.acceptedAt], [
    SHOPKEEPER_ID,
    'accepted',
    '2026-11-02T06:29:00Z',
  ]);
  assertStringIncludes(requests[0]?.url ?? '', `/rest/v1/calls?select=`);
  assertStringIncludes(requests[0]?.url ?? '', `&id=eq.${CALL_ID}`);
  assertEquals(requests[0]?.headers['apikey'], 'service-key');
  assertEquals(requests[0]?.headers['Authorization'], 'Bearer service-key');
});

Deno.test('postgrest › an unknown id returns null, not an error', async () => {
  const { repo } = setup({ body: [] }, { body: [] }, { body: [] }, { body: [] });
  assertEquals(await repo.getCallSession(CALL_ID), null);
  assertEquals(await repo.getShopkeeper(SHOPKEEPER_ID), null);
  assertEquals(await repo.getPromiseForCall(CALL_ID), null);
  assertEquals(await repo.getClaimForCall(CALL_ID), null);
});

Deno.test('postgrest › errors carry the operation and code only, never the database message', async () => {
  const { repo } = setup({
    status: 400,
    body: { code: '22P02', message: 'Key (amount)=(8500) bad' },
  });
  const error = await assertRejects(
    () =>
      repo.insertOwnerCallback({
        callId: CALL_ID,
        shopkeeperId: SHOPKEEPER_ID,
        reason: 'x',
        summary: 'y',
      }),
    RepositoryError,
  );
  assertEquals([error.message, error.code], ['insertOwnerCallback failed (22P02)', '22P02']);
});

Deno.test('postgrest › a non-JSON error body falls back to the HTTP status', async () => {
  const { repo } = setup({ status: 503 });
  await assertRejects(
    () => repo.getLedger(SHOPKEEPER_ID),
    RepositoryError,
    'getLedger failed (HTTP 503)',
  );
});

Deno.test('postgrest › maps the shopkeeper with the owner joined in', async () => {
  const row = {
    id: SHOPKEEPER_ID,
    name: 'Ramesh',
    shop_name: 'Ramesh Kirana',
    language: 'te',
    do_not_call: false,
    owners: { name: 'Srinivas Reddy', business_name: 'Sri Lakshmi Traders' },
  };
  const { repo, requests } = setup({ body: [row] });
  assertEquals(await repo.getShopkeeper(SHOPKEEPER_ID), {
    id: SHOPKEEPER_ID,
    name: 'Ramesh',
    shopName: 'Ramesh Kirana',
    language: 'te',
    doNotCall: false,
    ownerName: 'Srinivas Reddy',
    businessName: 'Sri Lakshmi Traders',
  });
  assertStringIncludes(requests[0]?.url ?? '', 'owners(name,business_name)');
});

Deno.test('postgrest › counts calls with HEAD + count=exact and reads the total', async () => {
  const { repo, requests } = setup({ headers: { 'content-range': '*/3' } });
  assertEquals(await repo.countCallsSince(SHOPKEEPER_ID, new Date('2026-11-01T18:30:00Z')), 3);
  assertEquals(requests[0]?.method, 'HEAD');
  assertEquals(requests[0]?.headers['Prefer'], 'count=exact');
  assertStringIncludes(requests[0]?.url ?? '', 'queued_at=gte.2026-11-01T18%3A30%3A00.000Z');
});

Deno.test('postgrest › a missing count is an error', async () => {
  const { repo } = setup({});
  await assertRejects(
    () => repo.countCallsSince(SHOPKEEPER_ID, new Date()),
    RepositoryError,
    'no count',
  );
});

Deno.test('postgrest › createCall returns the new id; an empty reply is an error', async () => {
  const { repo, requests } = setup({ body: [{ id: CALL_ID }] }, { body: [] });
  const call = { shopkeeperId: SHOPKEEPER_ID, language: 'te', mode: 'live' } as const;
  assertEquals(await repo.createCall(call), CALL_ID);
  assertEquals(JSON.parse(requests[0]?.body ?? '{}'), {
    shopkeeper_id: SHOPKEEPER_ID,
    language: 'te',
    mode: 'live',
  });
  await assertRejects(() => repo.createCall(call), RepositoryError, 'no row');
});

Deno.test('postgrest › findRingingCall asks for the newest queued or ringing call', async () => {
  const { repo, requests } = setup({ body: [{ ...SESSION_ROW, status: 'ringing' }] });
  assertEquals((await repo.findRingingCall(SHOPKEEPER_ID))?.status, 'ringing');
  assertStringIncludes(
    requests[0]?.url ?? '',
    'status=in.(queued,ringing)&order=queued_at.desc&limit=1',
  );
});

Deno.test('postgrest › transitionCall only updates from the expected status, sending set fields', async () => {
  const { repo, requests } = setup({ body: [{ id: CALL_ID }] }, { body: [] });
  const patch = {
    status: 'completed',
    endedAt: '2026-11-02T06:33:00Z',
    durationSeconds: 95,
  } as const;
  assertEquals(await repo.transitionCall(CALL_ID, ['accepted', 'in_progress'], patch), true);
  assertEquals(await repo.transitionCall(CALL_ID, ['ringing'], { status: 'accepted' }), false);
  assertEquals(requests[0]?.method, 'PATCH');
  assertStringIncludes(requests[0]?.url ?? '', 'status=in.(accepted,in_progress)');
  assertEquals(JSON.parse(requests[0]?.body ?? '{}'), {
    status: 'completed',
    ended_at: '2026-11-02T06:33:00Z',
    duration_seconds: 95,
  });
});

Deno.test('postgrest › every call field maps to its column', async () => {
  const { repo, requests } = setup({ body: [{ id: CALL_ID }] });
  await repo.transitionCall(CALL_ID, ['ringing'], {
    status: 'in_progress',
    ringingAt: 'a',
    acceptedAt: 'b',
    urlIssuedAt: 'c',
    interactionId: '20261102/x',
  });
  assertEquals(Object.keys(JSON.parse(requests[0]?.body ?? '{}')).sort(), [
    'accepted_at',
    'interaction_id',
    'ringing_at',
    'status',
    'url_issued_at',
  ]);
});

Deno.test('postgrest › recordIdentity only writes over the expected identity state', async () => {
  const { repo, requests } = setup({ body: [{ id: CALL_ID }] }, { body: [] });
  const expected = { status: 'unknown', unsureCount: 1 } as const;
  assertEquals(
    await repo.recordIdentity(CALL_ID, expected, { status: 'denied', unsureCount: 2 }),
    true,
  );
  assertEquals(
    await repo.recordIdentity(CALL_ID, expected, { status: 'confirmed', unsureCount: 1 }),
    false,
  );
  assertStringIncludes(
    requests[0]?.url ?? '',
    'identity_status=eq.unknown&identity_unsure_count=eq.1',
  );
  assertEquals(JSON.parse(requests[0]?.body ?? '{}'), {
    identity_status: 'denied',
    identity_unsure_count: 2,
  });
});

Deno.test('postgrest › the ledger is read oldest first, with numeric strings as numbers', async () => {
  const rows = [
    {
      kind: 'credit',
      amount: '5000.00',
      entry_date: '2026-10-06',
      due_date: '2026-10-21',
      status: 'confirmed',
    },
    { kind: 'payment', amount: 2000, entry_date: '2026-11-01', due_date: null, status: 'claimed' },
  ];
  const { repo, requests } = setup({ body: rows });
  const ledger = await repo.getLedger(SHOPKEEPER_ID);
  assertEquals(ledger[0], {
    kind: 'credit',
    amount: 5000,
    entryDate: '2026-10-06',
    dueDate: '2026-10-21',
    status: 'confirmed',
  });
  assertEquals(ledger[1]?.status, 'claimed');
  assertStringIncludes(requests[0]?.url ?? '', '&order=entry_date&limit=2000');
});

Deno.test('postgrest › an unexpected ledger value fails loudly', async () => {
  const bad = [{
    kind: 'gift',
    amount: 1,
    entry_date: '2026-10-06',
    due_date: null,
    status: 'confirmed',
  }];
  const { repo } = setup({ body: bad });
  await assertRejects(() => repo.getLedger(SHOPKEEPER_ID));
});

Deno.test("postgrest › reads the call's saved promise and claim", async () => {
  const { repo } = setup(
    { body: [{ amount: 3000, promise_date: '2026-11-09' }] },
    { body: [{ amount: '2000.00', entry_date: '2026-11-01', payment_mode: 'upi' }] },
  );
  assertEquals(await repo.getPromiseForCall(CALL_ID), { amount: 3000, promiseDate: '2026-11-09' });
  assertEquals(await repo.getClaimForCall(CALL_ID), {
    amount: 2000,
    paidDate: '2026-11-01',
    mode: 'upi',
  });
});

Deno.test("postgrest › updates the call's promise to the latest terms", async () => {
  const { repo, requests } = setup({ body: [{ id: CALL_ID }] }, { body: [] });
  const latest = { amount: 3000, promiseDate: '2026-11-10' };
  assertEquals(await repo.updatePromiseForCall(CALL_ID, latest), true);
  assertEquals(requests[0]?.method, 'PATCH');
  assertStringIncludes(requests[0]?.url ?? '', `promises?call_id=eq.${CALL_ID}&select=id`);
  assertEquals(JSON.parse(requests[0]?.body ?? ''), { amount: 3000, promise_date: '2026-11-10' });
  assertEquals(await repo.updatePromiseForCall(CALL_ID, latest), false);
});

Deno.test('postgrest › a promise or claim refused by the one-per-call rule returns false', async () => {
  const duplicate = { status: 409, body: { code: '23505' } };
  const { repo } = setup(duplicate, duplicate);
  const promise = {
    callId: CALL_ID,
    shopkeeperId: SHOPKEEPER_ID,
    amount: 3000,
    promiseDate: '2026-11-09',
  };
  assertEquals(await repo.insertPromise(promise), false);
  const claim = {
    callId: CALL_ID,
    shopkeeperId: SHOPKEEPER_ID,
    amount: 1,
    paidDate: '2026-11-01',
    mode: 'cash',
  } as const;
  assertEquals(await repo.insertPaymentClaim(claim), false);
});

Deno.test('postgrest › any other insert error is still thrown', async () => {
  const { repo } = setup({ status: 500, body: { code: 'XX000' } });
  const promise = {
    callId: CALL_ID,
    shopkeeperId: SHOPKEEPER_ID,
    amount: 3000,
    promiseDate: '2026-11-09',
  };
  await assertRejects(() => repo.insertPromise(promise), RepositoryError, 'XX000');
});

Deno.test('postgrest › writes use return=minimal and snake_case columns', async () => {
  const { repo, requests } = setup({}, {}, {}, {});
  assertEquals(
    await repo.insertPromise({
      callId: CALL_ID,
      shopkeeperId: SHOPKEEPER_ID,
      amount: 3000,
      promiseDate: '2026-11-09',
    }),
    true,
  );
  await repo.insertPaymentClaim({
    callId: CALL_ID,
    shopkeeperId: SHOPKEEPER_ID,
    amount: 2000,
    paidDate: '2026-11-01',
    mode: 'upi',
  });
  await repo.insertOwnerCallback({
    callId: CALL_ID,
    shopkeeperId: SHOPKEEPER_ID,
    reason: 'dispute',
    summary: 's',
  });
  await repo.insertToolEvent({
    callId: CALL_ID,
    tool: 'get_dues',
    args: {},
    result: { ok: true },
    durationMs: 120,
  });
  assertEquals(
    requests.map((request) => request.headers['Prefer']),
    Array(4).fill('return=minimal'),
  );
  assertEquals(JSON.parse(requests[1]?.body ?? '{}'), {
    shopkeeper_id: SHOPKEEPER_ID,
    call_id: CALL_ID,
    kind: 'payment',
    amount: 2000,
    entry_date: '2026-11-01',
    status: 'claimed',
    source: 'call',
    payment_mode: 'upi',
  });
  assertEquals(JSON.parse(requests[2]?.body ?? '{}').kind, 'owner_callback');
  assertEquals(JSON.parse(requests[3]?.body ?? '{}').duration_ms, 120);
});

Deno.test('postgrest › demo settings default to off when the row is missing', async () => {
  const row = {
    demo_clock: null,
    calling_hours_enabled: true,
    call_limits_enabled: false,
    live_shopkeeper_id: SHOPKEEPER_ID,
  };
  const { repo } = setup({ body: [] }, { body: [row] });
  assertEquals((await repo.getDemoSettings()).liveShopkeeperId, null);
  assertEquals(await repo.getDemoSettings(), {
    demoClock: null,
    callingHoursEnabled: true,
    callLimitsEnabled: false,
    liveShopkeeperId: SHOPKEEPER_ID,
  });
});

Deno.test('postgrest › a JSON error body without a code falls back to the HTTP status', async () => {
  const { repo } = setup({ status: 401, body: { message: 'JWT expired' } });
  await assertRejects(() => repo.getLedger(SHOPKEEPER_ID), RepositoryError, 'HTTP 401');
});
