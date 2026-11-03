// supabase/functions/_shared/ledger/promise-check.test.ts
// Decision 3 (a): kept when confirmed payments made between the promise and its date (+1 grace
// day) add up to the amount; broken the day after the grace day; open until then.
import { assertEquals } from '@std/assert';
import type { LedgerEntry } from '../schemas/ledger.ts';
import {
  applyPromiseChanges,
  checkPromises,
  judgePromise,
  paidTowards,
  type PromiseRecord,
} from './promise-check.ts';

/** Promise made on Mon 2 Nov (IST) for ₹3,000 by Fri 6 Nov. */
const PROMISE: PromiseRecord = {
  id: 'p1',
  amount: 3000,
  promiseDate: '2026-11-06',
  status: 'open',
  // 10:00 IST on 2 Nov.
  createdAt: '2026-11-02T04:30:00Z',
};

function payment(
  amount: number,
  entryDate: string,
  status: LedgerEntry['status'] = 'confirmed',
): LedgerEntry {
  return { kind: 'payment', amount, entryDate, dueDate: null, status };
}

const CREDIT: LedgerEntry = {
  kind: 'credit',
  amount: 5000,
  entryDate: '2026-10-06',
  dueDate: '2026-10-21',
  status: 'confirmed',
};

Deno.test('promise check › paid in full by the date is kept', () => {
  const entries = [CREDIT, payment(3000, '2026-11-05')];
  assertEquals(judgePromise(PROMISE, entries, '2026-11-08'), { status: 'kept', paid: 3000 });
});

Deno.test('promise check › paid in full on the grace day is still kept', () => {
  const entries = [payment(1000, '2026-11-03'), payment(2000, '2026-11-07')];
  assertEquals(judgePromise(PROMISE, entries, '2026-11-09'), { status: 'kept', paid: 3000 });
});

Deno.test('promise check › paid in full before the date is kept at once', () => {
  assertEquals(judgePromise(PROMISE, [payment(3500, '2026-11-02')], '2026-11-03'), {
    status: 'kept',
    paid: 3500,
  });
});

Deno.test('promise check › a part payment is broken after the grace day, with what was paid', () => {
  const entries = [payment(1000, '2026-11-04')];
  assertEquals(judgePromise(PROMISE, entries, '2026-11-08'), { status: 'broken', paid: 1000 });
});

Deno.test('promise check › nothing paid stays open up to the grace day, broken the day after', () => {
  assertEquals(judgePromise(PROMISE, [], '2026-11-06').status, 'open');
  assertEquals(judgePromise(PROMISE, [], '2026-11-07').status, 'open');
  assertEquals(judgePromise(PROMISE, [], '2026-11-08').status, 'broken');
});

Deno.test('promise check › claimed, rejected and late or earlier payments do not count', () => {
  const entries = [
    payment(3000, '2026-11-04', 'claimed'),
    payment(3000, '2026-11-04', 'rejected'),
    payment(3000, '2026-11-01'),
    payment(3000, '2026-11-08'),
    CREDIT,
  ];
  assertEquals(paidTowards(PROMISE, entries), 0);
  assertEquals(judgePromise(PROMISE, entries, '2026-11-09').status, 'broken');
});

Deno.test('promise check › a payment on the day the promise was made counts (IST date)', () => {
  // Made at 00:30 IST on 3 Nov = 19:00 UTC on 2 Nov: the IST day is the 3rd.
  const late = { ...PROMISE, createdAt: '2026-11-02T19:00:00Z' };
  assertEquals(paidTowards(late, [payment(3000, '2026-11-03')]), 3000);
  assertEquals(paidTowards(late, [payment(3000, '2026-11-02')]), 0);
});

Deno.test('promise check › paise add up exactly', () => {
  const entries = [payment(1000.1, '2026-11-03'), payment(1999.9, '2026-11-04')];
  assertEquals(judgePromise(PROMISE, entries, '2026-11-10'), { status: 'kept', paid: 3000 });
});

Deno.test('checkPromises › returns only open promises whose status changes', () => {
  const promises: PromiseRecord[] = [
    PROMISE,
    { ...PROMISE, id: 'p2', status: 'broken' },
    { ...PROMISE, id: 'p3', status: 'replaced' },
    { ...PROMISE, id: 'p4', promiseDate: '2026-11-20' },
  ];
  assertEquals(checkPromises(promises, [payment(500, '2026-11-03')], '2026-11-10'), [
    { id: 'p1', status: 'broken', paid: 500, amount: 3000 },
  ]);
});

Deno.test('checkPromises › uses the date passed in (demo clock) and running twice changes nothing', () => {
  assertEquals(checkPromises([PROMISE], [], '2026-11-05'), []);
  const changes = checkPromises([PROMISE], [], '2026-11-30');
  assertEquals(changes.map((change) => change.status), ['broken']);
  const after = [{ ...PROMISE, status: 'broken' as const }];
  assertEquals(checkPromises(after, [], '2026-11-30'), []);
});

Deno.test('applyPromiseChanges › updates changed promises only, without mutating the input', () => {
  const promises = [PROMISE, { ...PROMISE, id: 'p2' }];
  const changed = applyPromiseChanges(promises, [
    { id: 'p1', status: 'kept', paid: 3000, amount: 3000 },
  ]);
  assertEquals(changed.map((promise) => promise.status), ['kept', 'open']);
  assertEquals(PROMISE.status, 'open');
});
