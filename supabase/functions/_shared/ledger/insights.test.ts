// supabase/functions/_shared/ledger/insights.test.ts
// "insights" figures (SPEC §6.6, M6 Decision 7). Money: 100% tested. Small hand-made books so
// every figure can be checked by hand. "Today" is Wed 18 Nov 2026 unless a test says otherwise.
import { assertEquals } from '@std/assert';
import type { BookEntry, BookShopkeeper } from '../db/book-repository.ts';
import { bookEntry, LATHA, PRAVEEN_1, PRAVEEN_2, RAMESH } from '../db/fake-book-repository.ts';
import { computeInsights, monthSplit, percentOf, TOP_DEFAULTERS } from './insights.ts';

const TODAY = '2026-11-18';

/** A confirmed credit given on 25 Oct, due on `dueDate`. */
function credit(shopkeeper: BookShopkeeper, amount: number, dueDate: string): BookEntry {
  return bookEntry({
    shopkeeperId: shopkeeper.id,
    kind: 'credit',
    amount,
    dueDate,
    entryDate: '2026-10-25',
  });
}

function payment(
  shopkeeper: BookShopkeeper,
  amount: number,
  when: string | { date: string; status: BookEntry['status'] },
): BookEntry {
  const { date, status } = typeof when === 'string'
    ? { date: when, status: 'confirmed' as const }
    : when;
  return bookEntry({
    shopkeeperId: shopkeeper.id,
    kind: 'payment',
    amount,
    entryDate: date,
    status,
  });
}

Deno.test('insights › this month splits into collected / not yet due / overdue', () => {
  const entries = [
    credit(RAMESH, 5000, '2026-11-10'), // overdue, 2,000 paid → 3,000 overdue
    payment(RAMESH, 2000, '2026-11-12'),
    credit(LATHA, 4000, '2026-11-25'), // not yet due, unpaid
    credit(PRAVEEN_1, 1000, '2026-11-05'), // paid in full
    payment(PRAVEEN_1, 1000, '2026-11-04'),
    credit(PRAVEEN_2, 9999, '2026-12-05'), // next month: not in the pie
  ];
  const split = monthSplit(entries, TODAY, '2026-11');
  assertEquals(split, {
    month: '2026-11',
    collected: 3000,
    notYetDue: 4000,
    overdue: 3000,
    total: 10000,
  });
  assertEquals(percentOf(split), 30);
});

Deno.test('insights › payments clear the oldest credit first, even one from last month', () => {
  const entries = [
    credit(RAMESH, 3000, '2026-10-20'), // last month, gets the payment first
    credit(RAMESH, 2000, '2026-11-15'),
    payment(RAMESH, 4000, '2026-11-01'),
  ];
  const split = monthSplit(entries, TODAY, '2026-11');
  assertEquals([split.collected, split.overdue, split.total], [1000, 1000, 2000]);
});

Deno.test('insights › claimed and rejected payments do not count as collected', () => {
  const entries = [
    credit(RAMESH, 2000, '2026-11-20'),
    payment(RAMESH, 500, { date: '2026-11-10', status: 'claimed' }),
    payment(RAMESH, 700, { date: '2026-11-11', status: 'rejected' }),
  ];
  assertEquals(monthSplit(entries, TODAY, '2026-11').collected, 0);
});

Deno.test('insights › due today counts as not yet due; paise add up exactly', () => {
  const entries = [credit(RAMESH, 100.1, TODAY), credit(LATHA, 200.2, '2026-11-17')];
  const split = monthSplit(entries, TODAY, '2026-11');
  assertEquals([split.notYetDue, split.overdue, split.total], [100.1, 200.2, 300.3]);
});

Deno.test('insights › no credit due this month → no percentage, not 0%', () => {
  const insights = computeInsights([RAMESH], [credit(RAMESH, 500, '2026-12-01')], TODAY);
  assertEquals(insights.percentCollected, null);
  assertEquals(insights.weekChange, null);
  assertEquals(insights.outstanding, 500);
});

Deno.test("insights › change vs last week: this month's credit, as the book stood 7 days ago", () => {
  const entries = [
    credit(RAMESH, 1000, '2026-11-15'),
    credit(LATHA, 1000, '2026-11-25'),
    payment(RAMESH, 500, '2026-11-05'), // known a week ago (11 Nov)
    payment(LATHA, 500, '2026-11-16'), // after 11 Nov: not known a week ago
  ];
  const insights = computeInsights([RAMESH, LATHA], entries, TODAY);
  assertEquals(insights.percentCollected, 50);
  assertEquals(insights.weekChange, 25);
});

Deno.test('insights › entries dated after the demo-clock day are left out', () => {
  const entries = [credit(RAMESH, 1000, '2026-11-10'), payment(RAMESH, 1000, '2026-11-20')];
  const insights = computeInsights([RAMESH], entries, TODAY);
  assertEquals([insights.split.collected, insights.split.overdue], [0, 1000]);
  assertEquals(insights.outstanding, 1000);
});

Deno.test('insights › total outstanding covers every month', () => {
  const entries = [
    credit(RAMESH, 3000, '2026-09-10'),
    credit(LATHA, 2000, '2026-12-10'),
    credit(PRAVEEN_1, 0.3, '2026-11-30'),
  ];
  assertEquals(computeInsights([RAMESH, LATHA, PRAVEEN_1], entries, TODAY).outstanding, 5000.3);
});

Deno.test('insights › top defaulters: biggest overdue first, ties by days then name', () => {
  const entries = [
    credit(RAMESH, 3000, '2026-11-10'), // 3,000, 8 days
    credit(LATHA, 3000, '2026-11-01'), // 3,000, 17 days → before Ramesh
    credit(PRAVEEN_1, 3000, '2026-11-10'), // same as Ramesh → by name
    credit(PRAVEEN_2, 9000, '2026-11-17'), // biggest
  ];
  const top = computeInsights([RAMESH, LATHA, PRAVEEN_1, PRAVEEN_2], entries, TODAY).top;
  assertEquals(top.map((d) => [d.shopkeeper.name, d.overdueAmount, d.daysOverdue]), [
    ['Praveen', 9000, 1],
    ['Latha', 3000, 17],
    ['Praveen', 3000, 8],
    ['Ramesh', 3000, 8],
  ]);
});

Deno.test('insights › only people with overdue money, at most 5', () => {
  const many: BookShopkeeper[] = Array.from({ length: 8 }, (_, i) => ({
    ...RAMESH,
    id: `s${i}`,
    name: `S${i}`,
  }));
  const entries = [
    ...many.map((s, i) => credit(s, 100 * (i + 1), '2026-11-01')),
    credit(LATHA, 5000, '2026-11-30'), // not overdue
  ];
  const top = computeInsights([...many, LATHA], entries, TODAY).top;
  assertEquals(top.length, TOP_DEFAULTERS);
  assertEquals(top[0]?.shopkeeper.name, 'S7');
});

Deno.test('insights › an empty book', () => {
  assertEquals(computeInsights([RAMESH], [], TODAY), {
    today: TODAY,
    split: { month: '2026-11', collected: 0, notYetDue: 0, overdue: 0, total: 0 },
    percentCollected: null,
    weekChange: null,
    outstanding: 0,
    top: [],
  });
});
