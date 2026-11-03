// supabase/functions/_shared/tools/get-dues.test.ts
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import {
  FAKE_LATHA,
  FAKE_RAMESH,
  FAKE_RAMESH_PROMISES,
  type FakePromiseRecord,
} from '../db/fake-repository.ts';
import { getDues } from './get-dues.ts';
import { confirmedSetup, hasDigits, toolSetup } from './__fixtures__/tool-context.ts';

const CALL_ID = 'ca000000-0000-4000-8000-0000000000aa';
const NOTE = {
  shopkeeperId: FAKE_RAMESH.id,
  note: 'Travelling till Friday.',
  createdAt: '2026-10-28T10:00:00Z',
};

function brokenPromise(id: string, promiseDate: string): FakePromiseRecord {
  return {
    id,
    shopkeeperId: FAKE_RAMESH.id,
    amount: 1000,
    promiseDate,
    status: 'broken',
    createdAt: `${promiseDate}T00:00:00.000Z`,
  };
}

Deno.test('get_dues › refused before identity is confirmed, with no amount in the reply', async () => {
  const { ctx } = toolSetup();
  const outcome = await getDues(ctx, {});
  assert(!outcome.result.ok);
  assertEquals(outcome.result.code, 'IDENTITY_NOT_CONFIRMED');
  assertEquals(hasDigits(outcome.result.say), false);
});

Deno.test('get_dues › before identity: no memory or tone shared, nothing checked or stored', async () => {
  const open = { ...FAKE_RAMESH_PROMISES[1]!, status: 'open' as const };
  const { ctx, state } = toolSetup({
    state: { promiseHistory: [open], notes: [NOTE] },
  });
  const outcome = await getDues(ctx, {});
  assert(!outcome.result.ok);
  assertEquals(outcome.result.say.includes('Travelling'), false);
  assertEquals(outcome.result.say.includes('promise'), false);
  assertEquals(state.toneLevels, {});
  assertEquals(state.promiseHistory[0]?.status, 'open');
});

Deno.test('get_dues › refused after the person said they are someone else', async () => {
  const { ctx } = toolSetup({ call: { identityStatus: 'denied' } });
  const outcome = await getDues(ctx, {});
  assertEquals(outcome.result.ok ? null : outcome.result.code, 'IDENTITY_DENIED');
});

Deno.test('get_dues › Ramesh: seeded figures, no history → level 1 and no memory', async () => {
  const { ctx, state } = confirmedSetup();
  const outcome = await getDues(ctx, {});
  assert(outcome.result.ok);
  assertEquals(outcome.result.data, {
    outstanding: 8500,
    overdue_amount: 5000,
    oldest_due_date: '2026-10-21',
    days_overdue: 12,
    next_due_date: '2026-11-05',
    next_due_amount: 3500,
    last_promise_amount: null,
    last_promise_date: null,
    last_promise_status: null,
    last_promise_paid: null,
    last_note: null,
    rejected_claim_amount: null,
    rejected_claim_date: null,
    tone_level: 1,
    consequence: null,
  });
  assertStringIncludes(outcome.result.say, '8,500 rupees');
  assertStringIncludes(outcome.result.say, 'Tone level: 1 (friendly).');
  assertEquals(outcome.result.say.includes('Last promise'), false);
  assertEquals(state.toneLevels[CALL_ID], 1);
});

Deno.test('get_dues › Ramesh with his broken ₹3,000 promise and a note: memory + level 2', async () => {
  const { ctx, state } = confirmedSetup({
    state: { promiseHistory: FAKE_RAMESH_PROMISES, notes: [NOTE] },
  });
  const outcome = await getDues(ctx, {});
  assert(outcome.result.ok);
  assertEquals(outcome.result.data['tone_level'], 2);
  assertEquals(outcome.result.data['last_promise_status'], 'broken');
  assertEquals(outcome.result.data['last_promise_amount'], 3000);
  assertEquals(outcome.result.data['last_note'], 'Travelling till Friday.');
  assertStringIncludes(
    outcome.result.say,
    'Last promise: 3,000 rupees by Friday, 30 October 2026. Broken: 0 rupees of it was paid.',
  );
  assertStringIncludes(outcome.result.say, 'Last call note: "Travelling till Friday."');
  assertStringIncludes(outcome.result.say, 'Tone level: 2 (firm).');
  assertEquals(state.toneLevels[CALL_ID], 2);
});

Deno.test('get_dues › an open promise past its grace day is marked broken first', async () => {
  const open = { ...FAKE_RAMESH_PROMISES[1]!, status: 'open' as const };
  const { ctx, state } = confirmedSetup({ state: { promiseHistory: [open] } });
  const outcome = await getDues(ctx, {});
  assert(outcome.result.ok);
  assertEquals(state.promiseHistory[0]?.status, 'broken');
  assertEquals(outcome.result.data['last_promise_status'], 'broken');
  assertEquals(outcome.result.data['tone_level'], 2);
});

Deno.test("get_dues › level 3 says the owner's consequence; level 2 never does", async () => {
  const consequence = 'New stock on credit is paused until this is cleared.';
  const shopkeepers = [{ ...FAKE_RAMESH, consequenceText: consequence }];
  const twoBroken = [brokenPromise('a', '2026-10-01'), brokenPromise('b', '2026-10-20')];
  const firmer = confirmedSetup({ state: { shopkeepers, promiseHistory: twoBroken } });
  const outcome = await getDues(firmer.ctx, {});
  assert(outcome.result.ok);
  assertEquals(outcome.result.data['tone_level'], 3);
  assertEquals(outcome.result.data['consequence'], consequence);
  assertStringIncludes(outcome.result.say, `Consequence set by the owner: ${consequence}`);

  const firm = confirmedSetup({ state: { shopkeepers, promiseHistory: twoBroken.slice(1) } });
  const level2 = await getDues(firm.ctx, {});
  assert(level2.result.ok);
  assertEquals(level2.result.data['consequence'], null);
  assertEquals(level2.result.say.includes('Consequence'), false);
});

Deno.test('get_dues › 30+ days overdue on the demo clock is level 3 even with no broken promise', async () => {
  const { ctx } = confirmedSetup({ now: new Date('2026-11-20T12:00:00+05:30') });
  const outcome = await getDues(ctx, {});
  assert(outcome.result.ok);
  assertEquals(outcome.result.data['tone_level'], 3);
});

Deno.test("get_dues › reads only the call's own shopkeeper", async () => {
  const { ctx } = confirmedSetup({
    call: { shopkeeperId: FAKE_LATHA.id },
    state: { promiseHistory: FAKE_RAMESH_PROMISES, notes: [NOTE] },
  });
  const outcome = await getDues(ctx, {});
  assert(outcome.result.ok);
  assertEquals(outcome.result.data['outstanding'], 2000);
  assertEquals(outcome.result.data['last_promise_amount'], null);
  assertEquals(outcome.result.data['last_note'], null);
});

Deno.test('get_dues › days overdue follow the demo clock', async () => {
  const { ctx } = confirmedSetup({ now: new Date('2026-11-06T12:00:00+05:30') });
  const outcome = await getDues(ctx, {});
  assert(outcome.result.ok);
  assertEquals(outcome.result.data['days_overdue'], 16);
  assertEquals(outcome.result.data['overdue_amount'], 8500);
});

Deno.test('get_dues › nothing owed: says so', async () => {
  const { ctx } = confirmedSetup({ state: { ledger: [] } });
  const outcome = await getDues(ctx, {});
  assert(outcome.result.ok);
  assertEquals(outcome.result.data['outstanding'], 0);
  assertStringIncludes(outcome.result.say, 'Nothing is outstanding');
  assertEquals(outcome.result.say.includes('Tone level'), false);
});

Deno.test('get_dues › only future credits: says nothing is overdue yet', async () => {
  const ledger = [
    {
      shopkeeperId: FAKE_RAMESH.id,
      callId: null,
      paymentMode: null,
      kind: 'credit',
      amount: 1200,
      entryDate: '2026-10-30',
      dueDate: '2026-11-10',
      status: 'confirmed',
    },
  ] as const;
  const { ctx } = confirmedSetup({ state: { ledger } });
  const outcome = await getDues(ctx, {});
  assert(outcome.result.ok);
  assertStringIncludes(outcome.result.say, 'Nothing is overdue yet. Next due: 1,200 rupees');
});

Deno.test('get_dues › only overdue credits: no "next due" line', async () => {
  const { ctx } = confirmedSetup({ now: new Date('2026-11-20T12:00:00+05:30') });
  const outcome = await getDues(ctx, {});
  assert(outcome.result.ok);
  assertEquals(outcome.result.say.includes('Next due'), false);
});

Deno.test('get_dues › the figures come first and the closing instruction last', async () => {
  const { ctx } = confirmedSetup({ state: { promiseHistory: FAKE_RAMESH_PROMISES } });
  const outcome = await getDues(ctx, {});
  assert(outcome.result.ok);
  const say = outcome.result.say;
  assert(say.startsWith('Total outstanding: 8,500 rupees.'));
  assert(say.indexOf('Last promise') < say.indexOf('Tone level'));
  assert(say.endsWith('then ask when they can pay.'));
});
