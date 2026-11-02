// supabase/functions/_shared/db/supabase-repository.test.ts
// Checks the exact database requests and the row mapping, with a fake fetch (no network).
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { createPostgrestClient, RepositoryError } from './postgrest.ts';
import { createSupabaseRepository } from './supabase-repository.ts';

const ENV = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const CALL_ID = 'ca000000-0000-4000-8000-0000000000aa';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000002';

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

Deno.test('postgrest › sends the service key and maps the call session with its customer', async () => {
  const row = {
    id: CALL_ID,
    customer_id: CUSTOMER_ID,
    language: 'en',
    vapi_call_id: null,
    verified: false,
    verify_attempts: 0,
    started_at: '2026-11-02T03:48:48Z',
    customers: { dob: '1991-09-03', phone_masked: '+91 97XXXXXX45' },
  };
  const { repo, requests } = setup({ body: [row] });
  const session = await repo.getCallSession(CALL_ID);
  assertEquals(session?.customerDob, '1991-09-03');
  assertEquals(session?.phoneMasked, '+91 97XXXXXX45');
  assertStringIncludes(requests[0]?.url ?? '', `/rest/v1/calls?select=`);
  assertStringIncludes(requests[0]?.url ?? '', `&id=eq.${CALL_ID}`);
  assertEquals(requests[0]?.headers['apikey'], 'service-key');
  assertEquals(requests[0]?.headers['Authorization'], 'Bearer service-key');
});

Deno.test('postgrest › an unknown id returns null, not an error', async () => {
  const { repo } = setup({ body: [] }, { body: [] });
  assertEquals(await repo.getCallSession(CALL_ID), null);
  assertEquals(await repo.getCustomerForCall(CUSTOMER_ID), null);
});

Deno.test('postgrest › errors carry the operation and code only, never the database message', async () => {
  const { repo } = setup({
    status: 409,
    body: { code: '23505', message: 'Key (dob)=(1991-09-03) exists' },
  });
  const error = await assertRejects(
    () =>
      repo.insertHandoff({ callId: CALL_ID, customerId: CUSTOMER_ID, reason: 'x', summary: 'y' }),
    RepositoryError,
  );
  assertEquals(error.message, 'insertHandoff failed (23505)');
});

Deno.test('postgrest › a non-JSON error body falls back to the HTTP status', async () => {
  const { repo } = setup({ status: 503 });
  await assertRejects(
    () => repo.listCustomers(),
    RepositoryError,
    'listCustomers failed (HTTP 503)',
  );
});

Deno.test('postgrest › counts calls with HEAD + count=exact and reads the total', async () => {
  const { repo, requests } = setup({ headers: { 'content-range': '*/3' } });
  assertEquals(await repo.countCallsSince(CUSTOMER_ID, new Date('2026-11-01T18:30:00Z')), 3);
  assertEquals(requests[0]?.method, 'HEAD');
  assertEquals(requests[0]?.headers['Prefer'], 'count=exact');
  assertStringIncludes(requests[0]?.url ?? '', 'started_at=gte.2026-11-01T18%3A30%3A00.000Z');
});

Deno.test('postgrest › a missing count is an error', async () => {
  const { repo } = setup({});
  await assertRejects(
    () => repo.countCallsSince(CUSTOMER_ID, new Date()),
    RepositoryError,
    'no count',
  );
});

Deno.test('postgrest › claimCall only updates an unclaimed token and reports who won', async () => {
  const { repo, requests } = setup({ body: [{ id: CALL_ID }] }, { body: [] });
  assertEquals(await repo.claimCall(CALL_ID, 'vapi-1'), true);
  assertEquals(await repo.claimCall(CALL_ID, 'vapi-2'), false);
  assertEquals(requests[0]?.method, 'PATCH');
  assertStringIncludes(requests[0]?.url ?? '', 'vapi_call_id=is.null');
  assertEquals(requests[0]?.body, JSON.stringify({ vapi_call_id: 'vapi-1' }));
});

Deno.test('postgrest › createCall returns the new id; an empty reply is an error', async () => {
  const { repo } = setup({ body: [{ id: CALL_ID }] }, { body: [] });
  const call = { customerId: CUSTOMER_ID, language: 'en', attemptNo: 1 } as const;
  assertEquals(await repo.createCall(call), CALL_ID);
  await assertRejects(() => repo.createCall(call), RepositoryError, 'no row');
});

Deno.test('postgrest › listCustomers hides the do-not-call flag', async () => {
  const row = {
    id: CUSTOMER_ID,
    full_name: 'Anita Desai',
    preferred_language: 'en',
    city: 'Mumbai',
    do_not_call: false,
  };
  const { repo } = setup({ body: [row] });
  assertEquals(await repo.listCustomers(), [{
    id: CUSTOMER_ID,
    fullName: 'Anita Desai',
    language: 'en',
    city: 'Mumbai',
  }]);
});

Deno.test('postgrest › demo settings default to off when the row is missing', async () => {
  const { repo } = setup({ body: [] }, {
    body: [{ demo_clock: null, calling_hours_enabled: true, call_limits_enabled: false }],
  });
  assertEquals(await repo.getDemoSettings(), {
    demoClock: null,
    callingHoursEnabled: false,
    callLimitsEnabled: false,
  });
  assertEquals((await repo.getDemoSettings()).callingHoursEnabled, true);
});

Deno.test('postgrest › writes use return=minimal and snake_case columns', async () => {
  const { repo, requests } = setup({}, {}, {}, {}, {});
  await repo.recordVerification(CALL_ID, { verified: true, verifyAttempts: 1 });
  await repo.insertPromise({
    callId: CALL_ID,
    loanId: CALL_ID,
    amount: 6500,
    promiseDate: '2026-11-05',
    paymentMode: 'upi',
  });
  await repo.insertToolEvent({
    callId: CALL_ID,
    tool: 'lookup_loan',
    args: {},
    result: { ok: true },
  });
  await repo.insertHandoff({
    callId: CALL_ID,
    customerId: CUSTOMER_ID,
    reason: 'dispute',
    summary: 's',
  });
  assertEquals(
    requests.map((request) => request.headers['Prefer']),
    Array(4).fill('return=minimal'),
  );
  assertEquals(JSON.parse(requests[0]?.body ?? '{}'), { verified: true, verify_attempts: 1 });
  assertEquals(JSON.parse(requests[1]?.body ?? '{}').promise_date, '2026-11-05');
  assertStringIncludes(requests[2]?.url ?? '', '/rest/v1/tool_events');
});

Deno.test('postgrest › getLoanForCustomer asks for the most overdue loan', async () => {
  const loan = {
    id: '10000000-0000-4000-8000-000000000002',
    customer_id: CUSTOMER_ID,
    loan_number: 'SF-PL-100871',
    product: 'personal_loan',
    emi_amount: 6500,
    due_date: '2026-10-10',
    overdue_amount: 6500,
    days_past_due: 21,
    late_fee: 500,
  };
  const { repo, requests } = setup({ body: [loan] });
  assertEquals((await repo.getLoanForCustomer(CUSTOMER_ID))?.overdue_amount, 6500);
  assertStringIncludes(requests[0]?.url ?? '', 'order=days_past_due.desc&limit=1');
});
