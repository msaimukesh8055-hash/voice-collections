// supabase/functions/_shared/db/supabase-reminder-repository.test.ts
// Exact database requests of the M5 reminder queue and due alert, with a fake fetch (no network).
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { createPostgrestClient, RepositoryError } from './postgrest.ts';
import { createSupabaseReminderRepository } from './supabase-reminder-repository.ts';
import { fakeFetchFor, type FakeReply, type Recorded } from './__fixtures__/fake-fetch.ts';

const ENV = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const OWNER_ID = '0e000000-0000-4000-8000-000000000001';
const SHOPKEEPER_ID = '5e000000-0000-4000-8000-000000000001';
const CALL_ID = 'ca000000-0000-4000-8000-0000000000aa';
const NOW = new Date('2026-11-02T06:40:00.000Z');

function setup(...replies: FakeReply[]): {
  repo: ReturnType<typeof createSupabaseReminderRepository>;
  requests: Recorded[];
} {
  const { fetchImpl, requests } = fakeFetchFor(replies);
  return {
    repo: createSupabaseReminderRepository(createPostgrestClient(ENV, fetchImpl)),
    requests,
  };
}

function urlOf(request: Recorded | undefined): string {
  return decodeURIComponent(request?.url ?? '');
}

function bodyOf(request: Recorded | undefined): unknown {
  return JSON.parse(request?.body ?? 'null');
}

Deno.test('reminder repo › alert promises: open ones plus recent ones, for this owner', async () => {
  const row = {
    id: '90000000-0000-4000-8000-000000000002',
    shopkeeper_id: SHOPKEEPER_ID,
    amount: '3000.00',
    promise_date: '2026-10-30',
    status: 'broken',
    created_at: '2026-10-23T05:00:00Z',
  };
  const { repo, requests } = setup({ body: [row] });
  const promises = await repo.listAlertPromises(OWNER_ID, '2026-10-19');
  assertEquals(promises, [{
    id: row.id,
    shopkeeperId: SHOPKEEPER_ID,
    amount: 3000,
    promiseDate: '2026-10-30',
    status: 'broken',
    createdAt: '2026-10-23T05:00:00Z',
  }]);
  assertStringIncludes(urlOf(requests[0]), `shopkeepers.owner_id=eq.${OWNER_ID}`);
  assertStringIncludes(urlOf(requests[0]), 'or=(status.eq.open,promise_date.gte.2026-10-19)');
});

Deno.test('reminder repo › recent calls, paused and do-not-call shopkeepers', async () => {
  const { repo, requests } = setup(
    { body: [{ shopkeeper_id: SHOPKEEPER_ID, queued_at: '2026-11-02T06:00:00Z' }] },
    { body: [{ shopkeeper_id: SHOPKEEPER_ID }] },
    { body: [{ id: SHOPKEEPER_ID }] },
  );
  assertEquals(await repo.listCallsSince(NOW), [
    { shopkeeperId: SHOPKEEPER_ID, queuedAt: '2026-11-02T06:00:00Z' },
  ]);
  assertEquals(await repo.listPausedShopkeepers(), [SHOPKEEPER_ID]);
  assertEquals(await repo.listDoNotCall(OWNER_ID), [SHOPKEEPER_ID]);
  assertStringIncludes(urlOf(requests[0]), `queued_at=gte.${NOW.toISOString()}`);
  assertStringIncludes(urlOf(requests[1]), 'kind=eq.pause_reminders&status=eq.pending');
  assertStringIncludes(urlOf(requests[2]), 'do_not_call=eq.true');
});

Deno.test('reminder repo › calls are created in one insert', async () => {
  const { repo, requests } = setup({ body: [{ id: CALL_ID, shopkeeper_id: SHOPKEEPER_ID }] });
  const created = await repo.createCalls([
    { shopkeeperId: SHOPKEEPER_ID, language: 'te', mode: 'simulated' },
  ]);
  assertEquals(created, [{ callId: CALL_ID, shopkeeperId: SHOPKEEPER_ID }]);
  assertEquals(requests[0]?.method, 'POST');
  assertEquals(bodyOf(requests[0]), [
    { shopkeeper_id: SHOPKEEPER_ID, language: 'te', mode: 'simulated' },
  ]);
  assertEquals(await setup().repo.createCalls([]), []);
});

Deno.test('reminder repo › a simulated call is claimed through the database function', async () => {
  const { repo, requests } = setup({ body: CALL_ID }, { body: null });
  assertEquals(await repo.claimSimulatedCall(4, NOW), CALL_ID);
  assertEquals(await repo.claimSimulatedCall(4, NOW), null);
  assertStringIncludes(urlOf(requests[0]), '/rest/v1/rpc/claim_simulated_call');
  assertEquals(bodyOf(requests[0]), { max_running: 4, stale_before: NOW.toISOString() });
});

Deno.test('reminder repo › stale simulated calls are ended and queued for follow-up', async () => {
  const { repo, requests } = setup({ body: [{ id: CALL_ID }] });
  assertEquals(await repo.endStaleSimulatedCalls(NOW, NOW), [CALL_ID]);
  assertStringIncludes(urlOf(requests[0]), 'mode=eq.simulated&status=eq.in_progress');
  assertEquals(bodyOf(requests[0]), {
    status: 'completed',
    ended_at: NOW.toISOString(),
    followup_status: 'pending',
    followup_next_at: NOW.toISOString(),
  });
});

Deno.test('reminder repo › finishing a simulated call is a compare-and-set', async () => {
  const transcript = [{ role: 'assistant', content: 'Namaste' }] as const;
  const { repo, requests } = setup({ body: [{ id: CALL_ID }] }, { body: [] });
  const end = { transcript, endedAt: NOW, durationSeconds: 40 };
  assertEquals(await repo.finishSimulatedCall(CALL_ID, end), true);
  assertEquals(await repo.finishSimulatedCall(CALL_ID, end), false);
  assertStringIncludes(urlOf(requests[0]), `id=eq.${CALL_ID}&status=eq.in_progress`);
  assertEquals((bodyOf(requests[0]) as { transcript: unknown }).transcript, transcript);
});

Deno.test('reminder repo › persona, last inbound message and the daily alert log', async () => {
  const { repo, requests } = setup(
    { body: [{ persona: 'slow_payer' }] },
    { body: [] },
    { body: [{ created_at: '2026-11-02T05:00:00Z' }] },
    { body: [] },
    { status: 201 },
    { status: 409, body: { code: '23505' } },
  );
  assertEquals(await repo.getPersona(SHOPKEEPER_ID), 'slow_payer');
  assertEquals(await repo.getPersona(SHOPKEEPER_ID), null);
  assertEquals(await repo.lastInboundAt('abc'), '2026-11-02T05:00:00Z');
  assertEquals(await repo.lastInboundAt('abc'), null);
  const claim = { ownerId: OWNER_ID, day: '2026-11-02', kind: 'full' } as const;
  assertEquals(await repo.claimDailyAlert(claim), true);
  assertEquals(await repo.claimDailyAlert(claim), false);
  assertStringIncludes(urlOf(requests[2]), 'direction=eq.in&sender_hash=eq.abc');
  assertEquals(bodyOf(requests[4]), { owner_id: OWNER_ID, alert_day: '2026-11-02', kind: 'full' });
});

Deno.test('reminder repo › a database error surfaces as a RepositoryError', async () => {
  const { repo } = setup({ status: 500, body: { code: 'XX000' } });
  await assertRejects(() => repo.listPausedShopkeepers(), RepositoryError);
});
