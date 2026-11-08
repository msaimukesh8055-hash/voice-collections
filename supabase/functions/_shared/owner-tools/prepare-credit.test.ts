// supabase/functions/_shared/owner-tools/prepare-credit.test.ts
// prepare_credit + confirm (M8 B2, money, 100%): amount bounds, the 15-day default, past dates,
// the read-back figures, source 'munshi', and the balance after = computeDues after the write.
// Ramesh owes 8,500 rupees on FAKE_TODAY (2026-11-02). FAKE DATA ONLY.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { PRAVEEN_1, RAMESH } from '../db/fake-book-repository.ts';
import { computeDues } from '../ledger/dues.ts';
import { type CountedContext, later, ownerContext } from './__fixtures__/context.ts';
import { confirmAction } from './confirm-action.ts';
import { prepareCredit } from './prepare-credit.ts';

const YES_AFTER_MS = 5_000;

function prepare(
  context: CountedContext,
  args: { name?: string; amount?: number; due_date?: string } = {},
): ReturnType<typeof prepareCredit> {
  return prepareCredit(context.ctx, {
    name: args.name ?? 'Ramesh',
    amount: args.amount ?? 5000,
    due_date: args.due_date,
  });
}

function rameshOutstanding(context: CountedContext): number {
  const entries = context.book.entries.filter((entry) => entry.shopkeeperId === RAMESH.id);
  return computeDues(entries, context.ctx.today).outstanding;
}

Deno.test('prepare_credit › reads back person, amount, default due date and both balances', async () => {
  const context = ownerContext();

  const { result } = await prepare(context);

  assert(result.ok);
  assertStringIncludes(result.say, 'add a credit of 5,000 rupees for Ramesh, due Tue 17 Nov.');
  assertStringIncludes(result.say, 'His balance goes from 8,500 rupees to 13,500 rupees.');
  assertStringIncludes(result.say, 'action_ref r1');
  assertEquals(result.data['due_date'], '2026-11-17');
  assertEquals(context.book.entries.length, 8, 'nothing is saved before the yes');
});

Deno.test('prepare_credit › three round trips: name + ref together, entries, then the store', async () => {
  const context = ownerContext();

  await prepare(context);

  assertEquals(context.calls, [
    'listShopkeepers',
    'countVoiceActions',
    // Round ① also drops any open change, so a prepare that stores nothing leaves none open.
    'cancelOpenVoiceActions',
    'listShopkeeperEntries',
    'createVoiceAction',
    'cancelOpenVoiceActions',
  ]);
});

Deno.test('prepare_credit › a due date he says is kept; today is allowed', async () => {
  const context = ownerContext();

  const { result } = await prepare(context, { due_date: '2026-11-02' });

  assert(result.ok);
  assertEquals(result.data['due_date'], '2026-11-02');
});

Deno.test('prepare_credit › a past due date → DATE_IN_PAST, nothing read or stored', async () => {
  const context = ownerContext();

  const { result } = await prepare(context, { due_date: '2026-11-01' });

  assertEquals(result.ok ? 'ok' : result.code, 'DATE_IN_PAST');
  assertEquals(context.calls, []);
});

Deno.test('prepare_credit › amount bounds: 0, negative, over 10 lakh, NaN refused; 10 lakh ok', async () => {
  for (const amount of [0, -100, 1_000_001, Number.NaN, 0.001]) {
    const { result } = await prepare(ownerContext(), { amount });
    assertEquals(result.ok ? 'ok' : result.code, 'AMOUNT_OUT_OF_RANGE', String(amount));
  }
  const { result } = await prepare(ownerContext(), { amount: 1_000_000 });
  assert(result.ok);
});

Deno.test('prepare_credit › paise are kept to the paisa', async () => {
  const { result } = await prepare(ownerContext(), { amount: 250.505 });

  assert(result.ok);
  assertEquals(result.data['amount'], 250.51);
});

Deno.test('prepare_credit › an unclear name gives choices and stores nothing', async () => {
  const context = ownerContext();

  const { result } = await prepare(context, { name: 'Praveen' });

  assert(result.ok);
  assertStringIncludes(result.say, 'More than one shopkeeper fits');
  assertEquals(context.actions.actions, []);
});

Deno.test('prepare_credit › nobody by that name → NOT_FOUND (new people only on WhatsApp)', async () => {
  const context = ownerContext();

  const { result } = await prepare(context, { name: 'Zebulon' });

  assertEquals(result.ok ? 'ok' : result.code, 'NOT_FOUND');
  assertEquals(context.actions.actions, []);
});

Deno.test('prepare_credit › shop words after "which Praveen?" pick the right one', async () => {
  const context = ownerContext();

  const { result } = await prepare(context, { name: 'Praveen Bakery' });

  assert(result.ok);
  assertEquals(context.actions.actions[0]?.data, {
    shopkeeperId: PRAVEEN_1.id,
    name: 'Praveen (Praveen Bakery)',
    amount: 5000,
    dueDate: '2026-11-17',
  });
});

Deno.test('confirm credit › saves one confirmed credit, source munshi, today, due as read back', async () => {
  const context = ownerContext();
  await prepare(context);

  const { result } = await confirmAction(later(context, YES_AFTER_MS).ctx, { action_ref: 'r1' });

  assert(result.ok);
  const saved = context.book.entries.at(-1);
  assertEquals(
    [saved?.kind, saved?.amount, saved?.entryDate, saved?.dueDate, saved?.status],
    ['credit', 5000, '2026-11-02', '2026-11-17', 'confirmed'],
  );
  assertEquals(saved ? context.book.sources[saved.id] : null, 'munshi');
});

Deno.test('confirm credit › the reply balance equals computeDues after the write', async () => {
  const context = ownerContext();
  await prepare(context, { amount: 1234.5 });

  const { result } = await confirmAction(later(context, YES_AFTER_MS).ctx, { action_ref: 'r1' });

  assert(result.ok);
  assertEquals(result.data['outstanding'], rameshOutstanding(context));
  assertEquals(rameshOutstanding(context), 9734.5);
  assertStringIncludes(result.say, 'His balance is now 9,734.50 rupees.');
});
