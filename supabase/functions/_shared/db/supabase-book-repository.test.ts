// supabase/functions/_shared/db/supabase-book-repository.test.ts
// Checks the exact database requests and row mapping, with a fake fetch (no network).
import { assert, assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { createPostgrestClient } from './postgrest.ts';
import {
  createSupabaseBookRepository,
  PAGE_SIZE,
  PAGES_AT_ONCE,
} from './supabase-book-repository.ts';

const ENV = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const OWNER_ID = '0e000000-0000-4000-8000-000000000001';
const SHOPKEEPER_ID = '5e000000-0000-4000-8000-000000000001';
const ENTRY_ID = 'e0000000-0000-4000-8000-000000000001';
const ACTION_ID = 'ac000000-0000-4000-8000-000000000001';

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly prefer: string | undefined;
  readonly body: Record<string, unknown> | null;
}

interface FakeReply {
  readonly status?: number;
  readonly body?: unknown;
}

function setup(...replies: FakeReply[]): {
  repo: ReturnType<typeof createSupabaseBookRepository>;
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
    return Promise.resolve(
      new Response(text === '' ? null : text, { status: reply.status ?? 200 }),
    );
  }
  const repo = createSupabaseBookRepository(createPostgrestClient(ENV, fakeFetch));
  return { repo, requests };
}

const ENTRY = {
  id: ENTRY_ID,
  shopkeeper_id: SHOPKEEPER_ID,
  kind: 'payment',
  amount: '2000.00',
  entry_date: '2026-11-01',
  due_date: null,
  status: 'claimed',
  payment_mode: 'upi',
  created_at: '2026-11-01T10:00:00Z',
  shopkeepers: { owner_id: OWNER_ID },
};

const UNIQUE = { status: 409, body: { code: '23505' } };

Deno.test('book repo › owner and shopkeepers are read and mapped', async () => {
  const owner = {
    id: OWNER_ID,
    name: 'Srinivas Reddy',
    business_name: 'Sri Lakshmi Traders',
    city: 'Anantapur',
    language: 'te',
    english_under_telugu: true,
  };
  const shopkeeper = {
    id: SHOPKEEPER_ID,
    name: 'Ramesh',
    shop_name: 'Ramesh Kirana',
    area: 'Old Town',
    language: 'te',
  };
  const { repo, requests } = setup({ body: [owner] }, { body: [shopkeeper] });
  const read = await repo.getOwner();
  assertEquals([read?.businessName, read?.englishUnderTelugu], ['Sri Lakshmi Traders', true]);
  assertEquals((await repo.listShopkeepers(OWNER_ID))[0]?.shopName, 'Ramesh Kirana');
  assertStringIncludes(requests[0]?.url ?? '', '/rest/v1/owners?select=');
  assertStringIncludes(requests[1]?.url ?? '', `owner_id=eq.${OWNER_ID}`);
  assertStringIncludes(requests[1]?.url ?? '', 'limit=1000');
});

Deno.test('book repo › listEntries reads three pages at once and stops at a short page', async () => {
  const full = Array.from({ length: PAGE_SIZE }, () => ENTRY);
  const { repo, requests } = setup({ body: full }, { body: [ENTRY] }, { body: [] });
  const entries = await repo.listEntries(OWNER_ID);
  assertEquals(entries.length, PAGE_SIZE + 1);
  assertEquals(entries[0]?.amount, 2000);
  assertEquals(requests.length, PAGES_AT_ONCE);
  assertStringIncludes(requests[0]?.url ?? '', 'shopkeepers!inner(owner_id)');
  assertStringIncludes(requests[0]?.url ?? '', '&offset=0');
  assertStringIncludes(requests[1]?.url ?? '', `&offset=${PAGE_SIZE}`);
  assertStringIncludes(requests[2]?.url ?? '', `&offset=${2 * PAGE_SIZE}`);
});

Deno.test('book repo › listEntries asks for the next three pages only when all three were full', async () => {
  const full = { body: Array.from({ length: PAGE_SIZE }, () => ENTRY) };
  const { repo, requests } = setup(full, full, full, { body: [ENTRY] }, { body: [] }, {
    body: [],
  });
  assertEquals((await repo.listEntries(OWNER_ID)).length, 3 * PAGE_SIZE + 1);
  assertEquals(requests.length, 2 * PAGES_AT_ONCE);
  assertStringIncludes(requests[3]?.url ?? '', `&offset=${3 * PAGE_SIZE}`);
});

Deno.test('book repo › listEntries stops after 20 full pages', async () => {
  const full = { body: Array.from({ length: PAGE_SIZE }, () => ENTRY) };
  const { repo } = setup(...Array.from({ length: 20 }, () => full));
  await assertRejects(() => repo.listEntries(OWNER_ID), Error, 'too many pages');
});

Deno.test('book repo › shopkeeper entries and last promise', async () => {
  const promise = { amount: 3000, promise_date: '2026-10-30', status: 'broken' };
  const { repo, requests } = setup({ body: [ENTRY] }, { body: [promise] }, { body: [] });
  assertEquals((await repo.listShopkeeperEntries(SHOPKEEPER_ID))[0]?.status, 'claimed');
  assertEquals(await repo.getLastPromise(SHOPKEEPER_ID), {
    amount: 3000,
    promiseDate: '2026-10-30',
    status: 'broken',
  });
  assertEquals(await repo.getLastPromise(SHOPKEEPER_ID), null);
  assertStringIncludes(requests[1]?.url ?? '', 'order=created_at.desc&limit=1');
});

Deno.test('book repo › a new shopkeeper and a text entry are inserted', async () => {
  const shopkeeper = {
    id: SHOPKEEPER_ID,
    name: 'Suresh Babu',
    shop_name: 'Suresh Babu',
    area: 'Anantapur',
    language: 'te',
  };
  const { repo, requests } = setup({ body: [shopkeeper] }, { body: [{ id: ENTRY_ID }] });
  const created = await repo.insertShopkeeper({
    ownerId: OWNER_ID,
    name: 'Suresh Babu',
    shopName: 'Suresh Babu',
    area: 'Anantapur',
    phone: '+91 00000 91234',
    language: 'te',
  });
  const entryId = await repo.insertEntry({
    shopkeeperId: SHOPKEEPER_ID,
    kind: 'credit',
    amount: 3000,
    entryDate: '2026-11-02',
    dueDate: '2026-11-17',
    note: null,
  });
  assertEquals([created.id, entryId], [SHOPKEEPER_ID, ENTRY_ID]);
  assertEquals(requests[0]?.body?.['phone'], '+91 00000 91234');
  assertEquals([requests[1]?.body?.['source'], requests[1]?.body?.['status']], [
    'text',
    'confirmed',
  ]);
});

Deno.test('book repo › inserts that return no row fail loudly', async () => {
  const { repo } = setup({ body: [] }, { body: [] }, { body: [] });
  const entry = {
    shopkeeperId: SHOPKEEPER_ID,
    kind: 'payment' as const,
    amount: 1,
    entryDate: '2026-11-02',
    dueDate: null,
    note: null,
  };
  await assertRejects(() =>
    repo.insertShopkeeper({
      ownerId: OWNER_ID,
      name: 'X',
      shopName: 'X',
      area: 'A',
      phone: 'p',
      language: 'te',
    })
  );
  await assertRejects(() => repo.insertEntry(entry));
  await assertRejects(() =>
    repo.createPendingAction({ ownerId: OWNER_ID, kind: 'entry', payload: {}, expiresAt: 'x' })
  );
});

Deno.test('book repo › settling a claim only updates an open claimed payment', async () => {
  const { repo, requests } = setup({ body: [{ ...ENTRY, status: 'confirmed' }] }, { body: [] });
  assertEquals((await repo.settleClaim(ENTRY_ID, 'confirmed'))?.status, 'confirmed');
  assertEquals(await repo.settleClaim(ENTRY_ID, 'confirmed'), null);
  assertStringIncludes(requests[0]?.url ?? '', 'kind=eq.payment&status=eq.claimed');
  assertEquals([requests[0]?.method, requests[0]?.body], ['PATCH', { status: 'confirmed' }]);
});

Deno.test('book repo › pending actions: create, read, compare-and-set', async () => {
  const row = { id: ACTION_ID, kind: 'entry', payload: { a: 1 }, status: 'open', expires_at: 'x' };
  const { repo, requests } = setup(
    { body: [{ id: ACTION_ID }] },
    { body: [row] },
    { body: [{ id: ACTION_ID }] },
    { body: [] },
  );
  const created = await repo.createPendingAction({
    ownerId: OWNER_ID,
    kind: 'entry',
    payload: { a: 1 },
    expiresAt: 'x',
  });
  assertEquals(created, ACTION_ID);
  assertEquals((await repo.getPendingAction(ACTION_ID))?.status, 'open');
  assertEquals(await repo.transitionPendingAction(ACTION_ID, 'open', 'saved'), true);
  assertEquals(await repo.transitionPendingAction(ACTION_ID, 'open', 'saved'), false);
  assertStringIncludes(requests[2]?.url ?? '', `id=eq.${ACTION_ID}&status=eq.open`);
  assertEquals(requests[2]?.body?.['status'], 'saved');
});

Deno.test('book repo › a repeated message id is reported as already recorded', async () => {
  const { repo, requests } = setup({ status: 201 }, UNIQUE);
  const message = {
    waMessageId: 'wamid.1',
    senderHash: 'h',
    msgType: 'text',
    istDay: '2026-11-02',
  };
  assertEquals(await repo.recordInbound(message), true);
  assertEquals(await repo.recordInbound(message), false);
  assertEquals(requests[0]?.body?.['direction'], 'in');
});

Deno.test('book repo › other insert errors are not mistaken for duplicates', async () => {
  const { repo } = setup({ status: 500, body: { code: 'XX000' } });
  const message = {
    waMessageId: 'wamid.1',
    senderHash: 'h',
    msgType: 'text',
    istDay: '2026-11-02',
  };
  await assertRejects(() => repo.recordInbound(message), Error, 'XX000');
});

Deno.test('book repo › handled marks, outbound rows and the stranger reply rule', async () => {
  const { repo, requests } = setup({ status: 204 }, { status: 201 }, { status: 201 }, UNIQUE);
  await repo.markInboundHandled('wamid.1', { path: 'command', command: 'pending' });
  await repo.recordOutbound({ waMessageId: null, senderHash: 'h', msgType: 'text', istDay: 'd' });
  assertEquals(await repo.claimStrangerReply('h', '2026-11-02'), true);
  assertEquals(await repo.claimStrangerReply('h', '2026-11-02'), false);
  assertStringIncludes(requests[0]?.url ?? '', 'wa_message_id=eq.wamid.1&direction=eq.in');
  assertEquals(requests[0]?.body, { path: 'command', command: 'pending' });
  assert(requests[2]?.body?.['path'] === 'stranger' && requests[2]?.body?.['direction'] === 'out');
});

Deno.test("book repo › counts today's voice notes, up to the cap (M6)", async () => {
  const { repo, requests } = setup({
    status: 200,
    body: [{ id: ACTION_ID }, { id: SHOPKEEPER_ID }],
  });
  const count = await repo.countMessages({
    direction: 'in',
    msgType: 'voice',
    istDay: '2026-11-04',
    max: 50,
  });
  assertEquals(count, 2);
  assertStringIncludes(
    requests[0]?.url ?? '',
    'wa_messages?select=id&direction=eq.in&msg_type=eq.voice&ist_day=eq.2026-11-04&limit=50',
  );
});

Deno.test('book repo › a Munshi entry is saved with source munshi (M8)', async () => {
  const { repo, requests } = setup({ body: [{ id: ENTRY_ID }] });
  await repo.insertEntry({
    shopkeeperId: SHOPKEEPER_ID,
    kind: 'payment',
    amount: 2000,
    entryDate: '2026-11-02',
    dueDate: null,
    note: null,
    source: 'munshi',
  });
  assertEquals(requests[0]?.body?.['source'], 'munshi');
});

Deno.test('book repo › reverseEntry calls reverse_ledger_entry once and reads its answer', async () => {
  const CALL_ID = 'ca000000-0000-4000-8000-0000000000b1';
  const { repo, requests } = setup({ body: true }, { body: false });
  const first = await repo.reverseEntry(ENTRY_ID, CALL_ID);
  const second = await repo.reverseEntry(ENTRY_ID, CALL_ID);
  assertEquals([first, second], [true, false]);
  assertStringIncludes(requests[0]?.url ?? '', 'rpc/reverse_ledger_entry');
  assertEquals([requests[0]?.method, requests[0]?.body], [
    'POST',
    { entry_id: ENTRY_ID, owner_call_id: CALL_ID },
  ]);
});

Deno.test('book repo › reverseEntry refuses a reply that is not a boolean', async () => {
  const { repo } = setup({ body: { ok: true } });
  await assertRejects(() => repo.reverseEntry(ENTRY_ID, 'ca000000-0000-4000-8000-0000000000b1'));
});
