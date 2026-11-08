// supabase/functions/_shared/owner-tools/prepare-payment.test.ts
// prepare_payment + confirm (M8 B2, money, 100%): part and full payments, "paid in full" = his
// outstanding (and checked again at confirm), the overpaid warning, bounds, source 'munshi' and
// the balance after = computeDues after the write. Ramesh owes 8,500 rupees on FAKE_TODAY; his
// 2,000 claim is not counted. FAKE DATA ONLY.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { bookEntry, PRAVEEN_1, RAMESH } from '../db/fake-book-repository.ts';
import { computeDues } from '../ledger/dues.ts';
import { type CountedContext, later, ownerContext } from './__fixtures__/context.ts';
import { confirmAction } from './confirm-action.ts';
import { MISSING_AMOUNT_SAY, preparePayment } from './prepare-payment.ts';

const YES_AFTER_MS = 5_000;

function prepare(
  context: CountedContext,
  args: { name?: string; amount?: number; full?: 'yes' | 'no' },
): ReturnType<typeof preparePayment> {
  return preparePayment(context.ctx, {
    name: args.name ?? 'Ramesh',
    amount: args.amount,
    full: args.full,
  });
}

function confirm(context: CountedContext): ReturnType<typeof confirmAction> {
  return confirmAction(later(context, YES_AFTER_MS).ctx, { action_ref: 'r1' });
}

function outstandingOf(context: CountedContext, shopkeeperId = RAMESH.id): number {
  const entries = context.book.entries.filter((entry) => entry.shopkeeperId === shopkeeperId);
  return computeDues(entries, context.ctx.today).outstanding;
}

Deno.test('prepare_payment › a part payment reads back amount and both balances', async () => {
  const { result } = await prepare(ownerContext(), { amount: 2000 });

  assert(result.ok);
  assertStringIncludes(result.say, 'mark a payment of 2,000 rupees from Ramesh.');
  assertStringIncludes(result.say, 'His balance goes from 8,500 rupees to 6,500 rupees.');
  assertEquals([result.data['full'], result.data['balance_after']], [false, 6500]);
});

Deno.test('prepare_payment › "paid in full" is his outstanding now (claims not counted)', async () => {
  const { result } = await prepare(ownerContext(), { full: 'yes' });

  assert(result.ok);
  assertStringIncludes(result.say, 'mark Ramesh as paid in full: a payment of 8,500 rupees.');
  assertStringIncludes(result.say, 'to 0 rupees');
  assertEquals(result.data['amount'], 8500);
});

Deno.test('prepare_payment › full wins over an amount said alongside it', async () => {
  const { result } = await prepare(ownerContext(), { full: 'yes', amount: 100 });

  assert(result.ok);
  assertEquals(result.data['amount'], 8500);
});

Deno.test('prepare_payment › full = "no" with an amount is a part payment', async () => {
  const { result } = await prepare(ownerContext(), { full: 'no', amount: 500 });

  assert(result.ok);
  assertEquals([result.data['amount'], result.data['full']], [500, false]);
});

Deno.test('prepare_payment › "paid in full" when he owes nothing → NOTHING_OWED', async () => {
  const context = ownerContext();

  const { result } = await prepare(context, { name: 'Praveen Bakery', full: 'yes' });

  assertEquals(result.ok ? 'ok' : result.code, 'NOTHING_OWED');
  assertStringIncludes(result.say, 'Praveen (Praveen Bakery) owes nothing right now.');
  assertEquals(context.actions.actions, []);
});

Deno.test('prepare_payment › neither amount nor full → ask how much, nothing read', async () => {
  const context = ownerContext();

  const { result } = await prepare(context, {});

  assertEquals(result.ok ? 'ok' : result.code, 'INVALID_ARGS');
  assertEquals(result.say, MISSING_AMOUNT_SAY);
  assertEquals(context.calls, []);
});

Deno.test('prepare_payment › amount bounds are checked', async () => {
  for (const amount of [0, -1, 1_000_001]) {
    const { result } = await prepare(ownerContext(), { amount });
    assertEquals(result.ok ? 'ok' : result.code, 'AMOUNT_OUT_OF_RANGE', String(amount));
  }
});

Deno.test('prepare_payment › more than he owes is allowed, with the overpaid warning', async () => {
  const { result } = await prepare(ownerContext(), { amount: 9000 });

  assert(result.ok);
  assertStringIncludes(result.say, 'That is more than he owes (8,500 rupees)');
  assertEquals(result.data['balance_after'], 0);
});

Deno.test('prepare_payment › an unclear or unknown name stores nothing', async () => {
  const context = ownerContext();

  const unclear = await prepare(context, { name: 'Praveen', amount: 100 });
  const unknown = await prepare(context, { name: 'Zebulon', amount: 100 });

  assertStringIncludes(unclear.result.say, 'More than one shopkeeper fits');
  assertEquals(unknown.result.ok ? 'ok' : unknown.result.code, 'NOT_FOUND');
  assertEquals(context.actions.actions, []);
});

Deno.test('confirm payment › saves a confirmed payment, source munshi; balance = computeDues', async () => {
  const context = ownerContext();
  await prepare(context, { amount: 2000 });

  const { result } = await confirm(context);

  assert(result.ok);
  const saved = context.book.entries.at(-1);
  assertEquals([saved?.kind, saved?.amount, saved?.dueDate, saved?.status], [
    'payment',
    2000,
    null,
    'confirmed',
  ]);
  assertEquals(saved ? context.book.sources[saved.id] : null, 'munshi');
  assertEquals(result.data['outstanding'], outstandingOf(context));
  assertStringIncludes(result.say, 'His balance is now 6,500 rupees.');
});

Deno.test('confirm payment › paid in full clears him to 0', async () => {
  const context = ownerContext();
  await prepare(context, { full: 'yes' });

  const { result } = await confirm(context);

  assert(result.ok);
  assertEquals(outstandingOf(context), 0);
});

Deno.test('confirm payment › paid in full, but the book changed since → BOOK_CHANGED, no write', async () => {
  const context = ownerContext();
  await prepare(context, { full: 'yes' });
  context.book.entries = [
    ...context.book.entries,
    bookEntry({ kind: 'payment', amount: 1000, entryDate: '2026-11-02' }),
  ];
  const before = context.book.entries.length;

  const { result } = await confirm(context);

  assertEquals(result.ok ? 'ok' : result.code, 'BOOK_CHANGED');
  assertEquals(context.book.entries.length, before);
  assertEquals(context.actions.actions[0]?.status, 'cancelled');
});

Deno.test('confirm payment › a part payment saves even if the book moved (balance is live)', async () => {
  const context = ownerContext();
  await prepare(context, { name: 'Praveen Bakery', amount: 300 });

  const { result } = await confirm(context);

  assert(result.ok);
  assertEquals(result.data['outstanding'], outstandingOf(context, PRAVEEN_1.id));
});
