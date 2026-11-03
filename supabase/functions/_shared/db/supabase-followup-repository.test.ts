// supabase/functions/_shared/db/supabase-followup-repository.test.ts
// Exact database requests of the follow-up worker, with a fake fetch (no network).
import { assert, assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import type { FollowupCall } from './followup-repository.ts';
import { createPostgrestClient, RepositoryError } from './postgrest.ts';
import { createSupabaseFollowupRepository } from './supabase-followup-repository.ts';
import { fakeFetchFor, type FakeReply, type Recorded } from './__fixtures__/fake-fetch.ts';

const ENV = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const CALL_ID = 'ca000000-0000-4000-8000-0000000000aa';
const SHOPKEEPER_ID = '5e000000-0000-4000-8000-000000000001';
const ENTRY_ID = 'e1000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-02T06:40:00.000Z');

function setup(...replies: FakeReply[]): {
  repo: ReturnType<typeof createSupabaseFollowupRepository>;
  requests: Recorded[];
} {
  const { fetchImpl, requests } = fakeFetchFor(replies);
  return {
    repo: createSupabaseFollowupRepository(createPostgrestClient(ENV, fetchImpl)),
    requests,
  };
}

function bodyOf(request: Recorded | undefined): unknown {
  return JSON.parse(request?.body ?? 'null');
}

const CALL_ROW = {
  id: CALL_ID,
  shopkeeper_id: SHOPKEEPER_ID,
  mode: 'live',
  status: 'completed',
  identity_status: 'confirmed',
  tone_level: 2,
  interaction_id: '20261102/abc-21:45:10-x',
  transcript: null,
  queued_at: '2026-11-02T06:28:00Z',
  accepted_at: '2026-11-02T06:29:00Z',
  ended_at: '2026-11-02T06:32:00Z',
  followup_status: 'pending',
  followup_attempts: 0,
  followup_next_at: '2026-11-02T06:32:00Z',
  followup_claimed_at: null,
};

const CALL: FollowupCall = {
  callId: CALL_ID,
  shopkeeperId: SHOPKEEPER_ID,
  mode: 'live',
  status: 'completed',
  identityStatus: 'confirmed',
  toneLevel: 2,
  interactionId: '20261102/abc-21:45:10-x',
  transcript: null,
  queuedAt: '2026-11-02T06:28:00Z',
  acceptedAt: '2026-11-02T06:29:00Z',
  endedAt: '2026-11-02T06:32:00Z',
  followupStatus: 'pending',
  followupAttempts: 0,
  followupNextAt: '2026-11-02T06:32:00Z',
  followupClaimedAt: null,
};

Deno.test('followup db › reads and maps the call', async () => {
  const { repo, requests } = setup({ body: [CALL_ROW] }, { body: [] });
  assertEquals(await repo.getFollowupCall(CALL_ID), CALL);
  assertEquals(await repo.getFollowupCall(CALL_ID), null);
  assertStringIncludes(requests[0]?.url ?? '', `calls?select=id,shopkeeper_id`);
  assertStringIncludes(requests[0]?.url ?? '', `&id=eq.${CALL_ID}`);
});

Deno.test('followup db › a stored transcript is kept; an odd one counts as none', async () => {
  const turns = [{ role: 'user' as const, content: 'Hello' }];
  const { repo } = setup(
    { body: [{ ...CALL_ROW, transcript: turns }] },
    { body: [{ ...CALL_ROW, transcript: { weird: true } }] },
  );
  assertEquals((await repo.getFollowupCall(CALL_ID))?.transcript, turns);
  assertEquals((await repo.getFollowupCall(CALL_ID))?.transcript, null);
});

Deno.test('followup db › claim is a compare-and-set on status and attempts', async () => {
  const { repo, requests } = setup({ body: [{ id: CALL_ID }] }, { body: [] });
  assertEquals(await repo.claimFollowup(CALL, NOW), true);
  assertEquals(await repo.claimFollowup(CALL, NOW), false);
  assertEquals(requests[0]?.method, 'PATCH');
  assertStringIncludes(
    requests[0]?.url ?? '',
    `calls?id=eq.${CALL_ID}&followup_status=eq.pending&followup_attempts=eq.0`,
  );
  assertEquals(bodyOf(requests[0]), {
    followup_status: 'running',
    followup_attempts: 1,
    followup_claimed_at: NOW.toISOString(),
  });
});

Deno.test('followup db › release, fail and finish set the follow-up state', async () => {
  const { repo, requests } = setup({}, {}, {}, {});
  await repo.releaseFollowup(CALL_ID, NOW);
  await repo.failFollowup(CALL_ID);
  await repo.finishFollowup(CALL_ID, { transcript: null, summary: 'S', interactionId: null });
  await repo.finishFollowup(CALL_ID, { transcript: [], summary: null, interactionId: 'i/1' });
  assertEquals(bodyOf(requests[0]), {
    followup_status: 'pending',
    followup_next_at: NOW.toISOString(),
  });
  assertEquals(bodyOf(requests[1]), { followup_status: 'failed' });
  assertEquals(bodyOf(requests[2]), { followup_status: 'done', transcript: null, summary: 'S' });
  assertEquals(bodyOf(requests[3]), {
    followup_status: 'done',
    transcript: [],
    summary: null,
    interaction_id: 'i/1',
  });
});

Deno.test('followup db › due follow-ups: pending and due, then stale running, capped', async () => {
  const other = 'ca000000-0000-4000-8000-0000000000bb';
  const { repo, requests } = setup({ body: [{ id: CALL_ID }] }, { body: [{ id: other }] });
  assertEquals(await repo.listDueFollowups(NOW, 5), [CALL_ID, other]);
  assertStringIncludes(requests[0]?.url ?? '', 'followup_status=eq.pending&followup_next_at=lte.');
  assertStringIncludes(
    requests[1]?.url ?? '',
    'followup_status=eq.running&followup_claimed_at=lt.2026-11-02T06%3A35%3A00.000Z',
  );
  const capped = setup({ body: [{ id: CALL_ID }] }, { body: [{ id: other }] });
  assertEquals(await capped.repo.listDueFollowups(NOW, 1), [CALL_ID]);
});

Deno.test('followup db › call outcome: promise, open claim and callback requests', async () => {
  const { repo, requests } = setup(
    { body: [{ amount: '2000.00', promise_date: '2026-11-09' }] },
    { body: [{ id: ENTRY_ID, amount: 1000, entry_date: '2026-11-01', payment_mode: 'cash' }] },
    {
      body: [
        { reason: 'dispute', summary: 'Says a bill is wrong.' },
        { reason: 'something-else', summary: null },
      ],
    },
  );
  assertEquals(await repo.getCallOutcome(CALL_ID), {
    promise: { amount: 2000, promiseDate: '2026-11-09' },
    claim: { entryId: ENTRY_ID, amount: 1000, paidDate: '2026-11-01', mode: 'cash' },
    callbacks: [
      { reason: 'dispute', summary: 'Says a bill is wrong.' },
      { reason: 'other', summary: '' },
    ],
  });
  assertStringIncludes(requests[1]?.url ?? '', '&kind=eq.payment&status=eq.claimed');
  assertStringIncludes(requests[2]?.url ?? '', '&kind=eq.owner_callback');
});

Deno.test('followup db › call statuses for the score', async () => {
  const { repo, requests } = setup({ body: [{ status: 'completed' }, { status: 'missed' }] });
  assertEquals(await repo.listCallStatuses(SHOPKEEPER_ID), ['completed', 'missed']);
  assertStringIncludes(requests[0]?.url ?? '', `shopkeeper_id=eq.${SHOPKEEPER_ID}`);
});

Deno.test('followup db › one run and one note per call; a duplicate returns false', async () => {
  const duplicate = { status: 409, body: { code: '23505' } };
  const { repo, requests } = setup({}, duplicate, {}, duplicate);
  const run = {
    callId: CALL_ID,
    shopkeeperId: SHOPKEEPER_ID,
    path: 'rule',
    decision: 'check_promise',
    reasoning: 'Promise logged.',
    actions: { signals: [] },
  } as const;
  assertEquals(await repo.insertFollowupRun(run), true);
  assertEquals(await repo.insertFollowupRun(run), false);
  const note = { callId: CALL_ID, shopkeeperId: SHOPKEEPER_ID, note: 'Calm.' };
  assertEquals(await repo.insertNote(note), true);
  assertEquals(await repo.insertNote(note), false);
  assert(requests[0]?.url.endsWith('/rest/v1/followup_runs'));
  assertEquals(bodyOf(requests[2]), {
    call_id: CALL_ID,
    shopkeeper_id: SHOPKEEPER_ID,
    note: 'Calm.',
  });
});

Deno.test('followup db › other insert errors are thrown', async () => {
  const { repo } = setup({ status: 500, body: { code: 'XX000' } });
  await assertRejects(
    () => repo.insertNote({ callId: CALL_ID, shopkeeperId: SHOPKEEPER_ID, note: 'x' }),
    RepositoryError,
  );
});

Deno.test('followup db › follow-up row and score', async () => {
  const { repo, requests } = setup({}, {});
  await repo.insertFollowup({
    callId: CALL_ID,
    shopkeeperId: SHOPKEEPER_ID,
    kind: 'promise_check',
    reason: 'Check the promise.',
    scheduledFor: '2026-11-09T09:00:00+05:30',
  });
  const parts = { paidOnTime: 13, promisesKept: 15, currentOverdue: 13, answersCalls: 5 };
  const facts = {
    creditsJudged: 3,
    creditsOnTime: 1,
    promisesKept: 1,
    promisesBroken: 1,
    daysOverdue: 20,
    callsMade: 2,
    callsAnswered: 1,
  };
  await repo.saveScore(SHOPKEEPER_ID, { score: 46, band: 'risky', parts, facts }, NOW);
  assertEquals(bodyOf(requests[0]), {
    call_id: CALL_ID,
    shopkeeper_id: SHOPKEEPER_ID,
    kind: 'promise_check',
    reason: 'Check the promise.',
    scheduled_for: '2026-11-09T09:00:00+05:30',
  });
  assertStringIncludes(requests[1]?.url ?? '', `shopkeepers?id=eq.${SHOPKEEPER_ID}`);
  assertEquals(bodyOf(requests[1]), {
    score: 46,
    score_band: 'risky',
    score_parts: { parts, facts },
    score_updated_at: NOW.toISOString(),
  });
});
