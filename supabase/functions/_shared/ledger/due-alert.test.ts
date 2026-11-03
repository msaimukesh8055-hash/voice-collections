// supabase/functions/_shared/ledger/due-alert.test.ts
// Due alert (M5 test list): due today / overdue / broken promise sections, one section per
// person, only people who owe money, order of the Remind list. FAKE data.
import { assertEquals } from '@std/assert';
import {
  bookEntry,
  LATHA,
  PRAVEEN_1,
  PRAVEEN_2,
  RAMESH,
  SURESH,
} from '../db/fake-book-repository.ts';
import { type AlertPromise, BROKEN_ALERT_DAYS, buildDueAlert } from './due-alert.ts';
import { addDays } from '../clock.ts';

const TODAY = '2026-11-02';

function credit(
  shopkeeperId: string,
  amount: number,
  dueDate: string,
): ReturnType<typeof bookEntry> {
  return bookEntry({ shopkeeperId, kind: 'credit', amount, entryDate: '2026-10-01', dueDate });
}

function promise(fields: Partial<AlertPromise>): AlertPromise {
  return {
    id: crypto.randomUUID(),
    shopkeeperId: RAMESH.id,
    amount: 3000,
    promiseDate: '2026-10-30',
    status: 'broken',
    createdAt: '2026-10-23T05:00:00.000Z',
    ...fields,
  };
}

const SHOPKEEPERS = [RAMESH, LATHA, PRAVEEN_1, PRAVEEN_2, SURESH];

Deno.test('due alert › each section, each person once, in priority order', () => {
  const entries = [
    credit(RAMESH.id, 5000, '2026-10-21'),
    credit(LATHA.id, 2000, '2026-10-25'),
    credit(PRAVEEN_1.id, 1500, TODAY),
    credit(PRAVEEN_2.id, 900, '2026-11-20'),
  ];
  const alert = buildDueAlert({
    shopkeepers: SHOPKEEPERS,
    entries,
    promises: [promise({})],
    today: TODAY,
  });
  assertEquals(alert.brokenPromise.map((p) => p.shopkeeper.id), [RAMESH.id]);
  assertEquals(alert.overdue.map((p) => p.shopkeeper.id), [LATHA.id]);
  assertEquals(alert.dueToday.map((p) => p.shopkeeper.id), [PRAVEEN_1.id]);
});

Deno.test('due alert › people lists broken, then overdue, then due today', () => {
  const entries = [
    credit(PRAVEEN_1.id, 1500, TODAY),
    credit(LATHA.id, 2000, '2026-10-25'),
    credit(RAMESH.id, 5000, '2026-10-21'),
  ];
  const alert = buildDueAlert({
    shopkeepers: SHOPKEEPERS,
    entries,
    promises: [promise({})],
    today: TODAY,
  });
  assertEquals(alert.people.map((p) => p.reason), ['broken_promise', 'overdue', 'due_today']);
  assertEquals(alert.people[0]?.brokenPromise, { amount: 3000, promiseDate: '2026-10-30' });
  assertEquals(alert.people[1]?.brokenPromise, null);
});

Deno.test('due alert › overdue sorted by days overdue, then by amount', () => {
  const entries = [
    credit(LATHA.id, 2000, '2026-10-25'),
    credit(SURESH.id, 9000, '2026-10-25'),
    credit(PRAVEEN_1.id, 100, '2026-10-01'),
  ];
  const alert = buildDueAlert({ shopkeepers: SHOPKEEPERS, entries, promises: [], today: TODAY });
  assertEquals(alert.overdue.map((p) => p.shopkeeper.id), [PRAVEEN_1.id, SURESH.id, LATHA.id]);
});

Deno.test('due alert › due today sorted by amount due', () => {
  const entries = [credit(LATHA.id, 200, TODAY), credit(SURESH.id, 900, TODAY)];
  const alert = buildDueAlert({ shopkeepers: SHOPKEEPERS, entries, promises: [], today: TODAY });
  assertEquals(alert.dueToday.map((p) => p.shopkeeper.id), [SURESH.id, LATHA.id]);
});

Deno.test('due alert › nobody who has paid in full, or is only due later, is listed', () => {
  const entries = [
    credit(LATHA.id, 2000, '2026-10-25'),
    bookEntry({ shopkeeperId: LATHA.id, kind: 'payment', amount: 2000, entryDate: '2026-10-26' }),
    credit(SURESH.id, 900, '2026-11-20'),
  ];
  const alert = buildDueAlert({
    shopkeepers: SHOPKEEPERS,
    entries,
    promises: [promise({ shopkeeperId: LATHA.id })],
    today: TODAY,
  });
  assertEquals(alert.people, []);
});

Deno.test('due alert › a broken promise counts only if it is the newest and recent', () => {
  const entries = [credit(RAMESH.id, 5000, '2026-11-20')];
  const cases: ReadonlyArray<readonly [readonly AlertPromise[], number]> = [
    [[promise({})], 1],
    [[promise({ promiseDate: addDays(TODAY, -BROKEN_ALERT_DAYS) })], 1],
    [[promise({ promiseDate: addDays(TODAY, -BROKEN_ALERT_DAYS - 1) })], 0],
    [[promise({ promiseDate: addDays(TODAY, 1) })], 0],
    [[promise({ status: 'kept' })], 0],
    [[promise({}), promise({ status: 'open', createdAt: '2026-11-01T05:00:00.000Z' })], 0],
    [[promise({ status: 'open', createdAt: '2026-10-01T05:00:00.000Z' }), promise({})], 1],
  ];
  for (const [promises, expected] of cases) {
    const alert = buildDueAlert({ shopkeepers: SHOPKEEPERS, entries, promises, today: TODAY });
    assertEquals(alert.brokenPromise.length, expected, JSON.stringify(promises));
  }
});

Deno.test('due alert › overdue and due today at once counts as overdue', () => {
  const entries = [credit(LATHA.id, 2000, '2026-10-25'), credit(LATHA.id, 500, TODAY)];
  const alert = buildDueAlert({ shopkeepers: SHOPKEEPERS, entries, promises: [], today: TODAY });
  assertEquals([alert.overdue.length, alert.dueToday.length], [1, 0]);
});
