// supabase/functions/_shared/owner-tools/book-summary.test.ts
// book_summary's figures (M8, 100% target): the same money rules as WhatsApp (confirmed entries
// only, oldest credit paid first), one round of reads, and a short `say`.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { BookShopkeeper } from '../db/book-repository.ts';
import {
  bookEntry,
  fakeBookEntries,
  LATHA,
  PRAVEEN_1,
  RAMESH,
  SURESH,
} from '../db/fake-book-repository.ts';
import { FAKE_TODAY } from '../db/fake-repository.ts';
import type { AlertPromise } from '../ledger/due-alert.ts';
import { type ContextOptions, ownerContext } from './__fixtures__/context.ts';
import { bookSummary, weekLine } from './book-summary.ts';
import { BOOK_FOCUSES, type BookFocus } from './schemas.ts';
import { MAX_SAY_CHARS } from './say.ts';

interface Answer {
  readonly say: string;
  readonly data: Record<string, unknown>;
}

async function ask(focus: BookFocus, options: ContextOptions = {}): Promise<Answer> {
  const { ctx } = ownerContext(options);
  const { result } = await bookSummary(ctx, { focus });
  assert(result.ok);
  return { say: result.say, data: { ...result.data } };
}

function alertPromise(fields: Partial<AlertPromise>): AlertPromise {
  return {
    id: crypto.randomUUID(),
    shopkeeperId: RAMESH.id,
    amount: 1000,
    promiseDate: '2026-11-04',
    status: 'open',
    createdAt: '2026-10-28T05:00:00.000Z',
    ...fields,
  };
}

/** Suresh owes ₹1,200 due today. */
const DUE_TODAY = bookEntry({
  shopkeeperId: SURESH.id,
  kind: 'credit',
  amount: 1200,
  entryDate: '2026-10-18',
  dueDate: FAKE_TODAY,
});

Deno.test('book_summary › every focus reads once, in one parallel round, and answers', async () => {
  for (const focus of BOOK_FOCUSES) {
    const { ctx, calls } = ownerContext();
    const { result } = await bookSummary(ctx, { focus });
    assert(result.ok, focus);
    assertEquals(result.data['focus'], focus);
    assertEquals(calls.sort(), ['listAlertPromises', 'listEntries', 'listShopkeepers']);
  }
});

Deno.test('book_summary › overview: pending, overdue and due today', async () => {
  const { say, data } = await ask('overview');
  assertEquals(data, {
    focus: 'overview',
    outstanding: 10500,
    people_owing: 2,
    overdue_amount: 7000,
    overdue_people: 2,
    due_today_people: 0,
  });
  assertEquals(
    say,
    'Total pending: 10,500 rupees from 2 people. Overdue: 7,000 rupees from 2 people. ' +
      'Nobody is due today.',
  );
});

Deno.test('book_summary › overview names who is due today', async () => {
  const { say, data } = await ask('overview', { entries: [...fakeBookEntries(), DUE_TODAY] });
  assertEquals([data['outstanding'], data['due_today_people']], [11700, 1]);
  assertStringIncludes(say, 'Due today: 1 person: Suresh 1,200 rupees.');
});

Deno.test('book_summary › due: who is due today, biggest first, and the overdue total', async () => {
  const latha = bookEntry({
    shopkeeperId: LATHA.id,
    kind: 'credit',
    amount: 300,
    entryDate: '2026-10-18',
    dueDate: FAKE_TODAY,
  });
  const { say, data } = await ask('due', { entries: [...fakeBookEntries(), DUE_TODAY, latha] });
  assertEquals(data, {
    focus: 'due',
    due_today_people: 2,
    due_today_amount: 1500,
    overdue_people: 2,
    overdue_amount: 7000,
  });
  assertEquals(
    say,
    'Due today: 2 people, 1,500 rupees in all: Suresh 1,200 rupees; Latha 300 rupees. ' +
      'Also overdue: 2 people, 7,000 rupees.',
  );
});

Deno.test('book_summary › due: nobody due, nobody overdue', async () => {
  const { say, data } = await ask('due', { entries: [] });
  assertEquals(say, 'Nobody is due today. Nobody is overdue.');
  assertEquals([data['due_today_amount'], data['overdue_amount']], [0, 0]);
});

Deno.test('book_summary › overdue: most overdue first, with days late', async () => {
  const { say, data } = await ask('overdue');
  assertEquals(data, { focus: 'overdue', overdue_people: 2, overdue_amount: 7000 });
  assertEquals(
    say,
    'Overdue: 7,000 rupees from 2 people. Most overdue: Ramesh 5,000 rupees, 12 days late; ' +
      'Latha 2,000 rupees, 8 days late.',
  );
});

Deno.test('book_summary › overdue: equal amounts → the longer wait first', async () => {
  const late = bookEntry({
    shopkeeperId: SURESH.id,
    kind: 'credit',
    amount: 2000,
    entryDate: '2026-10-01',
    dueDate: '2026-10-16',
  });
  const { say } = await ask('overdue', { entries: [...fakeBookEntries(), late] });
  assertStringIncludes(say, 'Suresh 2,000 rupees, 17 days late; Latha 2,000 rupees, 8 days late');
});

Deno.test('book_summary › overdue: nobody', async () => {
  const { say, data } = await ask('overdue', { entries: [] });
  assertEquals([say, data['overdue_people']], ['Nobody is overdue.', 0]);
});

Deno.test('book_summary › promises: open this week and broken in the last 14 days', async () => {
  const alertPromises = [
    alertPromise({ shopkeeperId: LATHA.id, amount: 2000, promiseDate: '2026-11-05' }),
    alertPromise({ amount: 3000, promiseDate: '2026-10-30', status: 'broken' }),
    // Outside the windows: due in 10 days, broken 20 days ago.
    alertPromise({ shopkeeperId: SURESH.id, promiseDate: '2026-11-12' }),
    alertPromise({ promiseDate: '2026-10-13', status: 'broken' }),
  ];
  const { say, data } = await ask('promises', { alertPromises });
  assertEquals(data, { focus: 'promises', open_promises: 1, broken_promises: 1 });
  assertEquals(
    say,
    'Promised for the next 7 days: Latha 2,000 rupees by Thu 5 Nov. ' +
      'Broken in the last 14 days: Ramesh 3,000 rupees was due Fri 30 Oct.',
  );
});

Deno.test('book_summary › promises: an open promise past its date is judged broken in memory', async () => {
  const stale = alertPromise({ amount: 3000, promiseDate: '2026-10-30' });
  const { data, say } = await ask('promises', { alertPromises: [stale] });
  assertEquals([data['open_promises'], data['broken_promises']], [0, 1]);
  assertStringIncludes(say, 'Ramesh 3,000 rupees was due Fri 30 Oct');
});

Deno.test('book_summary › promises: none, and an unknown shopkeeper is "Someone"', async () => {
  const none = await ask('promises');
  assertEquals(
    none.say,
    'No promises fall due in the next 7 days. No promise was broken in the last 14 days.',
  );
  const orphan = alertPromise({ shopkeeperId: '5e000000-0000-4000-8000-000000000999' });
  const { say } = await ask('promises', { alertPromises: [orphan] });
  assertStringIncludes(say, 'Someone 1,000 rupees by Wed 4 Nov');
});

Deno.test('book_summary › claims: waiting payment claims, never counted as paid', async () => {
  const { say, data } = await ask('claims');
  assertEquals(data, { focus: 'claims', open_claims: 1, claimed_amount: 2000 });
  assertEquals(
    say,
    'Payment claims waiting for you: 1, 2,000 rupees in all: Ramesh says 2,000 rupees paid on ' +
      'Sun 1 Nov by upi. They count only after he confirms them.',
  );
});

Deno.test('book_summary › claims: none, and a claim with no mode', async () => {
  assertEquals((await ask('claims', { entries: [] })).say, 'No payment claims are waiting.');
  const claim = bookEntry({
    shopkeeperId: LATHA.id,
    kind: 'payment',
    amount: 500,
    entryDate: '2026-11-02',
    status: 'claimed',
    paymentMode: 'bank_transfer',
  });
  const cash = bookEntry({
    kind: 'payment',
    amount: 100,
    status: 'claimed',
    entryDate: '2026-10-30',
  });
  const { say } = await ask('claims', { entries: [claim, cash] });
  assertStringIncludes(say, 'Latha says 500 rupees paid on Mon 2 Nov by bank transfer; Ramesh');
  assertStringIncludes(say, 'Ramesh says 100 rupees paid on Fri 30 Oct.');
});

Deno.test('book_summary › insights: month split, week change, pending and top defaulters', async () => {
  const { say, data } = await ask('insights');
  assertEquals(data, {
    focus: 'insights',
    percent_collected: 0,
    week_change: 0,
    outstanding: 10500,
    month_total: 3500,
  });
  assertEquals(
    say,
    'This month: 0% collected of 3,500 rupees due (collected 0 rupees, overdue 0 rupees, not yet ' +
      'due 3,500 rupees). Same as last week. Total pending: 10,500 rupees. ' +
      'Top defaulters: Ramesh 5,000 rupees; Latha 2,000 rupees.',
  );
});

Deno.test('book_summary › insights: an empty book', async () => {
  const { say, data } = await ask('insights', { entries: [] });
  assertEquals([data['percent_collected'], data['outstanding']], [null, 0]);
  assertEquals(say, 'No credit falls due this month. Total pending: 0 rupees.');
});

Deno.test('book_summary › insights: a payment this week moves the figure up', async () => {
  const credit = bookEntry({
    shopkeeperId: SURESH.id,
    kind: 'credit',
    amount: 1000,
    entryDate: '2026-10-01',
    dueDate: '2026-11-01',
  });
  const paid = bookEntry({
    shopkeeperId: SURESH.id,
    kind: 'payment',
    amount: 1000,
    entryDate: '2026-11-02',
  });
  const { say, data } = await ask('insights', { entries: [...fakeBookEntries(), credit, paid] });
  assertEquals([data['percent_collected'], data['week_change']], [22, 22]);
  assertStringIncludes(say, 'This month: 22% collected of 4,500 rupees due');
  assertStringIncludes(say, 'Up 22 points since last week.');
});

Deno.test('book_summary › weekLine words every change', () => {
  assertEquals(
    [weekLine(null), weekLine(0), weekLine(5), weekLine(-3)],
    ['', 'Same as last week.', 'Up 5 points since last week.', 'Down 3 points since last week.'],
  );
});

Deno.test('book_summary › reversed and claimed entries never count', async () => {
  const reversedCredit = bookEntry({
    shopkeeperId: SURESH.id,
    kind: 'credit',
    amount: 9000,
    entryDate: '2026-10-01',
    dueDate: '2026-10-16',
    status: 'reversed',
  });
  const reversedPayment = bookEntry({
    kind: 'payment',
    amount: 5000,
    entryDate: '2026-10-25',
    status: 'reversed',
  });
  const rejected = bookEntry({ kind: 'payment', amount: 1000, status: 'rejected' });
  const entries = [...fakeBookEntries(), reversedCredit, reversedPayment, rejected];
  const { data } = await ask('overview', { entries });
  assertEquals([data['outstanding'], data['overdue_amount']], [10500, 7000]);
  const claims = await ask('claims', { entries });
  assertEquals(claims.data['open_claims'], 1);
});

Deno.test('book_summary › an empty book', async () => {
  const { say, data } = await ask('overview', { shopkeepers: [], entries: [] });
  assertEquals([say, data['outstanding']], ['Nothing is pending in the book.', 0]);
});

Deno.test('book_summary › same-name shopkeepers are told apart by shop', async () => {
  const late = bookEntry({
    shopkeeperId: PRAVEEN_1.id,
    kind: 'credit',
    amount: 900,
    entryDate: '2026-10-01',
    dueDate: '2026-10-16',
  });
  const { say } = await ask('overdue', { entries: [late] });
  assertStringIncludes(say, 'Praveen (Praveen Bakery) 900 rupees');
});

Deno.test('book_summary › 100 shopkeepers: at most 3 names, a true count, under the cap', async () => {
  const shopkeepers: BookShopkeeper[] = Array.from({ length: 100 }, (_, n) => ({
    ...RAMESH,
    id: `5e000000-0000-4000-8000-${String(1000 + n).padStart(12, '0')}`,
    name: `Shopkeeper Number ${n} With A Long Name`,
    shopName: `Shop ${n}`,
  }));
  const entries = shopkeepers.map((shopkeeper, n) =>
    bookEntry({
      shopkeeperId: shopkeeper.id,
      kind: 'credit',
      amount: 1000 + n,
      entryDate: '2026-10-01',
      dueDate: n % 2 === 0 ? FAKE_TODAY : '2026-10-16',
    })
  );
  for (const focus of BOOK_FOCUSES) {
    const { say } = await ask(focus, { shopkeepers, entries });
    assert(say.length <= MAX_SAY_CHARS, `${focus}: ${say.length}`);
  }
  const { say, data } = await ask('overdue', { shopkeepers, entries });
  assertEquals(data['overdue_people'], 50);
  assertStringIncludes(say, ', and 47 more.');
});
