// supabase/functions/_shared/db/supabase-memory.test.ts
// Exact database requests behind memory and tone, with a fake fetch (no network).
import { assertEquals, assertStringIncludes } from '@std/assert';
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
