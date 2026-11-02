// supabase/functions/_shared/tools/get-dues.test.ts
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { FAKE_LATHA, FAKE_RAMESH } from '../db/fake-repository.ts';
import { getDues } from './get-dues.ts';
import { confirmedSetup, hasDigits, toolSetup } from './__fixtures__/tool-context.ts';

Deno.test('get_dues › refused before identity is confirmed, with no amount in the reply', async () => {
  const { ctx } = toolSetup();
  const outcome = await getDues(ctx, {});
  assert(!outcome.result.ok);
  assertEquals(outcome.result.code, 'IDENTITY_NOT_CONFIRMED');
  assertEquals(hasDigits(outcome.result.say), false);
});

Deno.test('get_dues › refused after the person said they are someone else', async () => {
  const { ctx } = toolSetup({ call: { identityStatus: 'denied' } });
  const outcome = await getDues(ctx, {});
  assertEquals(outcome.result.ok ? null : outcome.result.code, 'IDENTITY_DENIED');
});

Deno.test('get_dues › Ramesh: his seeded figures plus the M5 placeholders', async () => {
  const { ctx } = confirmedSetup();
  const outcome = await getDues(ctx, {});
  assert(outcome.result.ok);
  assertEquals(outcome.result.data, {
    outstanding: 8500,
    overdue_amount: 5000,
    oldest_due_date: '2026-10-21',
    days_overdue: 12,
    next_due_date: '2026-11-05',
    next_due_amount: 3500,
    memory: null,
    tone_level: 1,
  });
  assertStringIncludes(outcome.result.say, '8,500 rupees');
  assertStringIncludes(outcome.result.say, '5,000 rupees');
});

Deno.test("get_dues › reads only the call's own shopkeeper", async () => {
  const { ctx } = confirmedSetup({ call: { shopkeeperId: FAKE_LATHA.id } });
  const outcome = await getDues(ctx, {});
  assert(outcome.result.ok);
  assertEquals(outcome.result.data['outstanding'], 2000);
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
