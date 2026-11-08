// supabase/functions/_shared/owner-tools/prepare-delete.test.ts
// prepare_delete + confirm (M8 B3, money, 100%): newest by default, filters, up to 3 choices
// newest first, only live entries offered, any age, the reversal written once with this owner
// call, and the balance after. Ramesh on FAKE_TODAY: credits 4,000 (Sep, paid), 5,000 (6 Oct),
// 3,500 (21 Oct), payment 4,000 (24 Sep), claim 2,000 (not live). FAKE DATA ONLY.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { bookEntry, fakeBookEntries, RAMESH } from '../db/fake-book-repository.ts';
import { FAKE_OWNER_CALL_ID } from '../db/fake-owner-call-repository.ts';
import { computeDues } from '../ledger/dues.ts';
import {
  type ContextOptions,
  type CountedContext,
  later,
  ownerContext,
} from './__fixtures__/context.ts';
import { confirmAction } from './confirm-action.ts';
import { ALREADY_CHANGED_SAY, deletable, prepareDelete } from './prepare-delete.ts';

const YES_AFTER_MS = 5_000;

type Filters = { kind?: 'credit' | 'payment'; amount?: number; entry_date?: string };

function prepare(context: CountedContext, filters: Filters = {}): ReturnType<typeof prepareDelete> {
  return prepareDelete(context.ctx, { name: 'Ramesh', ...filters });
}

function confirm(context: CountedContext): ReturnType<typeof confirmAction> {
  return confirmAction(later(context, YES_AFTER_MS).ctx, { action_ref: 'r1' });
}

function outstanding(context: CountedContext): number {
  const entries = context.book.entries.filter((entry) => entry.shopkeeperId === RAMESH.id);
  return computeDues(entries, context.ctx.today).outstanding;
}

function storedEntryId(context: CountedContext): string {
  const data = context.actions.actions[0]?.data as { entryId?: string } | undefined;
  return data?.entryId ?? '';
}

function withEntries(extra: Parameters<typeof bookEntry>[0][]): ContextOptions {
  return { entries: [...fakeBookEntries(), ...extra.map(bookEntry)] };
}

Deno.test('prepare_delete › with only the name, his newest live entry; balance before/after', async () => {
  const context = ownerContext();

  const { result } = await prepare(context);

  assert(result.ok);
  assertStringIncludes(result.say, "delete Ramesh's credit of 3,500 rupees on Wed 21 Oct.");
  assertStringIncludes(result.say, 'It stays on record as reversed.');
  assertStringIncludes(result.say, 'from 8,500 rupees to 5,000 rupees');
  assertEquals(context.book.entries.filter((e) => e.status === 'reversed'), []);
});

Deno.test('prepare_delete › the claimed payment is never offered (not live)', async () => {
  const { result } = await prepare(ownerContext(), { kind: 'payment' });

  assert(result.ok);
  assertStringIncludes(result.say, 'payment of 4,000 rupees on Thu 24 Sept');
});

Deno.test('prepare_delete › kind alone means the newest of that kind', async () => {
  const context = ownerContext();

  await prepare(context, { kind: 'credit' });

  assertEquals(context.actions.actions.length, 1);
});

Deno.test('prepare_delete › an amount picks the one entry; an old entry is allowed', async () => {
  const { result } = await prepare(ownerContext(), { amount: 4000, kind: 'credit' });

  assert(result.ok);
  assertStringIncludes(result.say, 'credit of 4,000 rupees on Sat 5 Sept');
  // Without that old credit, his 4,000 payment clears the next oldest one (oldest first).
  assertStringIncludes(result.say, 'from 8,500 rupees to 4,500 rupees');
});

Deno.test('prepare_delete › two equal credits on different days → "which one", nothing stored', async () => {
  const context = ownerContext(withEntries([
    { kind: 'credit', amount: 5000, entryDate: '2026-10-28', dueDate: '2026-11-12' },
  ]));

  const { result } = await prepare(context, { amount: 5000 });

  assert(result.ok);
  assertStringIncludes(result.say, 'More than one entry fits');
  assert(
    result.say.indexOf('Wed 28 Oct') < result.say.indexOf('Tue 6 Oct'),
    'newest first',
  );
  assertEquals(result.data['choice_count'], 2);
  assertEquals(context.actions.actions, []);
});

Deno.test('prepare_delete › then the date he picks → only that one', async () => {
  const context = ownerContext(withEntries([
    { kind: 'credit', amount: 5000, entryDate: '2026-10-28', dueDate: '2026-11-12' },
  ]));

  const { result } = await prepare(context, { amount: 5000, entry_date: '2026-10-06' });

  assert(result.ok);
  assertStringIncludes(result.say, 'Tue 6 Oct');
});

Deno.test('prepare_delete › more than 3 fits: 3 shown with "and N more"', async () => {
  const context = ownerContext(withEntries([
    { kind: 'payment', amount: 100, entryDate: '2026-10-25' },
    { kind: 'payment', amount: 100, entryDate: '2026-10-26' },
    { kind: 'payment', amount: 100, entryDate: '2026-10-27' },
    { kind: 'payment', amount: 100, entryDate: '2026-10-28' },
  ]));

  const { result } = await prepare(context, { amount: 100 });

  assertStringIncludes(result.say, 'and 1 more');
});

Deno.test('prepare_delete › entries he cannot tell apart count as one (the newest is taken)', async () => {
  const twin = {
    kind: 'credit' as const,
    amount: 700,
    entryDate: '2026-10-30',
    dueDate: '2026-11-14',
  };
  const context = ownerContext(withEntries([
    { ...twin, createdAt: '2026-10-30T09:00:00Z' },
    { ...twin, createdAt: '2026-10-30T10:00:00Z' },
  ]));
  const newest = context.book.entries.at(-1)?.id;

  const { result } = await prepare(context, { amount: 700 });

  assert(result.ok);
  assertEquals(storedEntryId(context), newest);
});

Deno.test('prepare_delete › nothing fits → NOTHING_TO_DELETE; unclear/unknown names store nothing', async () => {
  const context = ownerContext();

  const none = await prepare(context, { amount: 1 });
  const unclear = await prepareDelete(context.ctx, { name: 'Praveen' });
  const unknown = await prepareDelete(context.ctx, { name: 'Zebulon' });

  assertEquals(none.result.ok ? 'ok' : none.result.code, 'NOTHING_TO_DELETE');
  assertStringIncludes(unclear.result.say, 'More than one shopkeeper fits');
  assertEquals(unknown.result.ok ? 'ok' : unknown.result.code, 'NOT_FOUND');
  assertEquals(context.actions.actions, []);
});

Deno.test('deletable › only confirmed entries, newest first; a date filter', () => {
  const entries = fakeBookEntries().filter((entry) => entry.shopkeeperId === RAMESH.id);

  const all = deletable(entries, {});
  const onDay = deletable(entries, { entry_date: '2026-10-06' });

  assertEquals(all.map((entry) => entry.amount), [3500, 5000, 4000, 4000]);
  assertEquals(onDay.map((entry) => entry.amount), [5000]);
});

Deno.test('confirm delete › reversed (kept), one ledger_reversals row with this call; balance drops', async () => {
  const context = ownerContext();
  await prepare(context);
  const count = context.book.entries.length;

  const { result } = await confirm(context);

  assert(result.ok);
  const id = storedEntryId(context);
  assertEquals(context.book.entries.length, count, 'nothing removed');
  assertEquals(context.book.entries.find((entry) => entry.id === id)?.status, 'reversed');
  assertEquals(context.book.reversals, [{ entryId: id, ownerCallId: FAKE_OWNER_CALL_ID }]);
  assertEquals([result.data['outstanding'], outstanding(context)], [5000, 5000]);
  assertStringIncludes(result.say, 'Balance is now 5,000 rupees.');
});

Deno.test('confirm delete › a reversed payment raises the balance', async () => {
  const context = ownerContext();
  await prepare(context, { kind: 'payment' });

  const { result } = await confirm(context);

  assert(result.ok);
  assertEquals(outstanding(context), 12500);
});

Deno.test('confirm delete › already reversed meanwhile → refused, nothing written twice', async () => {
  const context = ownerContext();
  await prepare(context);
  const id = storedEntryId(context);
  await context.ctx.writes.book.reverseEntry(id, FAKE_OWNER_CALL_ID);

  const { result } = await confirm(context);

  assertEquals(result.ok ? 'ok' : result.code, 'NOTHING_TO_DELETE');
  assertEquals(result.say, ALREADY_CHANGED_SAY);
  assertEquals(context.book.reversals.length, 1);
  assertEquals(context.actions.actions[0]?.status, 'cancelled');
});
