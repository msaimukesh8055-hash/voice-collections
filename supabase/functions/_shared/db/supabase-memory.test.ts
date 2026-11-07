// supabase/functions/_shared/db/supabase-memory.test.ts
// Exact database requests behind memory and tone, with a fake fetch (no network).
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { createPostgrestClient } from './postgrest.ts';
import { memoryQueries } from './supabase-memory.ts';
import { fakeFetchFor, type FakeReply, type Recorded } from './__fixtures__/fake-fetch.ts';

const ENV = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const SHOPKEEPER_ID = '5e000000-0000-4000-8000-000000000001';
const PROMISE_ID = '90000000-0000-4000-8000-000000000002';
const CALL_ID = 'ca000000-0000-4000-8000-0000000000aa';

function setup(...replies: FakeReply[]): {
  repo: ReturnType<typeof memoryQueries>;
  requests: Recorded[];
} {
  const { fetchImpl, requests } = fakeFetchFor(replies);
  return { repo: memoryQueries(createPostgrestClient(ENV, fetchImpl)), requests };
}

Deno.test('memory db › lists promises newest first and maps them', async () => {
  const row = {
    id: PROMISE_ID,
    amount: '3000.00',
    promise_date: '2026-10-30',
    status: 'broken',
    created_at: '2026-10-23T05:00:00+00:00',
  };
  const { repo, requests } = setup({ body: [row] });
  assertEquals(await repo.listPromises(SHOPKEEPER_ID), [
    {
      id: PROMISE_ID,
      amount: 3000,
      promiseDate: '2026-10-30',
      status: 'broken',
      createdAt: '2026-10-23T05:00:00+00:00',
    },
  ]);
  assertStringIncludes(requests[0]?.url ?? '', `shopkeeper_id=eq.${SHOPKEEPER_ID}`);
  assertStringIncludes(requests[0]?.url ?? '', 'order=created_at.desc&limit=100');
});

Deno.test('memory db › reads the newest note, or null', async () => {
  const { repo, requests } = setup({ body: [{ note: 'Travelling.' }] }, { body: [] });
  assertEquals(await repo.getLastNote(SHOPKEEPER_ID), 'Travelling.');
  assertEquals(await repo.getLastNote(SHOPKEEPER_ID), null);
  assertStringIncludes(requests[0]?.url ?? '', 'shopkeeper_notes?select=note');
  assertStringIncludes(requests[0]?.url ?? '', 'order=created_at.desc&limit=1');
});

Deno.test('memory db › promise status changes only from open (compare-and-set)', async () => {
  const { repo, requests } = setup({ body: [{ id: PROMISE_ID }] }, { body: [] });
  assertEquals(await repo.setPromiseStatus(PROMISE_ID, 'broken'), true);
  assertEquals(await repo.setPromiseStatus(PROMISE_ID, 'broken'), false);
  assertEquals(requests[0]?.method, 'PATCH');
  assertStringIncludes(requests[0]?.url ?? '', `promises?id=eq.${PROMISE_ID}&status=eq.open`);
  assertEquals(JSON.parse(requests[0]?.body ?? '{}'), { status: 'broken' });
});

Deno.test('memory db › stores the tone level on the call', async () => {
  const { repo, requests } = setup({});
  await repo.setCallToneLevel(CALL_ID, 2);
  assertEquals(requests[0]?.method, 'PATCH');
  assertStringIncludes(requests[0]?.url ?? '', `calls?id=eq.${CALL_ID}`);
  assertEquals(JSON.parse(requests[0]?.body ?? '{}'), { tone_level: 2 });
});

const PAST_CALL_ROW = {
  id: 'ca000000-0000-4000-8000-0000000000b1',
  queued_at: '2026-10-29T05:30:00+00:00',
  mode: 'live',
  status: 'completed',
  identity_status: 'confirmed',
  promises: [{
    id: PROMISE_ID,
    amount: '3000.00',
    promise_date: '2026-10-30',
    status: 'open',
    created_at: '2026-10-23T05:00:00+00:00',
  }],
  ledger_entries: [{
    amount: '500.00',
    entry_date: '2026-10-28',
    status: 'claimed',
    payment_mode: null,
  }],
  followups: [{ kind: 'owner_callback', reason: 'hardship', summary: 'Harvest is late' }],
  followup_runs: [{ actions: { outcome: 'claim', signals: ['angry', 'made_up'] } }],
};
const SINCE = new Date('2026-05-04T00:00:00.000Z');

Deno.test('memory db › past calls: one request with the linked rows embedded', async () => {
  const { repo, requests } = setup({ body: [] });
  assertEquals(await repo.listPastCalls(SHOPKEEPER_ID, CALL_ID, SINCE), []);
  assertEquals(requests.length, 1);
  const url = decodeURIComponent(requests[0]?.url ?? '');
  assertStringIncludes(
    url,
    'calls?select=id,queued_at,mode,status,identity_status,' +
      'promises(id,amount,promise_date,status,created_at),' +
      'ledger_entries(amount,entry_date,status,payment_mode),followups(kind,reason,summary),' +
      'followup_runs(actions)',
  );
  assertStringIncludes(url, '&ledger_entries.kind=eq.payment&followups.kind=eq.owner_callback');
  assertStringIncludes(url, `&shopkeeper_id=eq.${SHOPKEEPER_ID}&id=neq.${CALL_ID}`);
  assertStringIncludes(url, '&status=in.(completed,declined,missed)');
  assertStringIncludes(url, '&queued_at=gte.2026-05-04T00:00:00.000Z');
  assertStringIncludes(url, '&order=queued_at.desc&limit=3');
  assertEquals(url.includes('reasoning'), false);
});

Deno.test('memory db › past calls: rows mapped; only known signals kept', async () => {
  const { repo } = setup({ body: [PAST_CALL_ROW] });
  assertEquals(await repo.listPastCalls(SHOPKEEPER_ID, CALL_ID, SINCE), [{
    id: PAST_CALL_ROW.id,
    queuedAt: PAST_CALL_ROW.queued_at,
    mode: 'live',
    status: 'completed',
    identityStatus: 'confirmed',
    promises: [{
      id: PROMISE_ID,
      amount: 3000,
      promiseDate: '2026-10-30',
      status: 'open',
      createdAt: '2026-10-23T05:00:00+00:00',
    }],
    claims: [{ amount: 500, paidDate: '2026-10-28', mode: null, status: 'claimed' }],
    followups: [{ kind: 'owner_callback', reason: 'hardship', summary: 'Harvest is late' }],
    signals: ['angry'],
  }]);
});

Deno.test('memory db › past calls: empty embeds and odd actions give no signals', async () => {
  const odd = { actions: { signals: 'angry' } };
  const row = {
    ...PAST_CALL_ROW,
    promises: [],
    ledger_entries: [],
    followups: [],
    followup_runs: [odd, { actions: null }, { actions: [] }],
  };
  const [past] = await setup({ body: [row] }).repo.listPastCalls(SHOPKEEPER_ID, CALL_ID, SINCE);
  assertEquals(past?.signals, []);
  assertEquals(past?.claims, []);
});

Deno.test('memory db › past calls: a bad row is an error, as for every read', async () => {
  const { repo } = setup({ body: [{ ...PAST_CALL_ROW, status: 'ringing' }] });
  await assertRejects(() => repo.listPastCalls(SHOPKEEPER_ID, CALL_ID, SINCE));
});
