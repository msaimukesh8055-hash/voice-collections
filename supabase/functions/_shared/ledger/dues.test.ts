// supabase/functions/_shared/ledger/dues.test.ts
import { assertEquals } from '@std/assert';
import type { LedgerEntry } from '../schemas/ledger.ts';
import { computeDues, NO_DUES } from './dues.ts';

const TODAY = '2026-11-02';

function credit(amount: number, dueDate: string, entryDate = '2026-10-01'): LedgerEntry {
  return { kind: 'credit', amount, entryDate, dueDate, status: 'confirmed' };
}

function payment(
  amount: number,
  status: LedgerEntry['status'] = 'confirmed',
  entryDate = '2026-10-20',
): LedgerEntry {
  return { kind: 'payment', amount, entryDate, dueDate: null, status };
}

Deno.test('dues › an empty book owes nothing', () => {
  assertEquals(computeDues([], TODAY), NO_DUES);
});

Deno.test('dues › an unpaid credit past its due date is overdue, counted in whole days', () => {
  const dues = computeDues([credit(5000, '2026-10-21')], TODAY);
  assertEquals(dues.outstanding, 5000);
  assertEquals(dues.overdueAmount, 5000);
  assertEquals([dues.oldestDueDate, dues.daysOverdue], ['2026-10-21', 12]);
});

Deno.test('dues › payments clear the oldest credit first', () => {
  const entries = [credit(3000, '2026-10-28'), credit(5000, '2026-10-03'), payment(5000)];
  const dues = computeDues(entries, TODAY);
  assertEquals([dues.outstanding, dues.overdueAmount], [3000, 3000]);
  assertEquals([dues.oldestDueDate, dues.daysOverdue], ['2026-10-28', 5]);
});

Deno.test('dues › credits due the same day are added together as the next amount due', () => {
  const entries = [
    credit(1000, '2026-11-10', '2026-10-25'),
    credit(2000, '2026-11-10', '2026-10-20'),
    credit(500, '2026-11-20'),
    payment(1500),
  ];
  const dues = computeDues(entries, TODAY);
  assertEquals([dues.nextDueDate, dues.nextDueAmount, dues.outstanding], [
    '2026-11-10',
    1500,
    2000,
  ]);
});

Deno.test('dues › a part payment leaves the rest of the credit open', () => {
  const dues = computeDues([credit(5000, '2026-10-23'), payment(2000)], TODAY);
  assertEquals([dues.outstanding, dues.overdueAmount, dues.daysOverdue], [3000, 3000, 10]);
});

Deno.test('dues › a credit due today or later is outstanding but not overdue', () => {
  const dues = computeDues([credit(3500, '2026-11-02'), credit(1500, '2026-11-05')], TODAY);
  assertEquals([dues.outstanding, dues.overdueAmount, dues.daysOverdue], [5000, 0, 0]);
  assertEquals([dues.nextDueDate, dues.nextDueAmount], ['2026-11-02', 3500]);
  assertEquals(dues.oldestDueDate, '2026-11-02');
});

Deno.test('dues › overdue and upcoming parts are split (Ramesh-style book)', () => {
  const entries = [
    credit(4000, '2026-09-20'),
    payment(4000),
    credit(5000, '2026-10-21'),
    credit(3500, '2026-11-05'),
  ];
  assertEquals(computeDues(entries, TODAY), {
    outstanding: 8500,
    overdueAmount: 5000,
    oldestDueDate: '2026-10-21',
    daysOverdue: 12,
    nextDueDate: '2026-11-05',
    nextDueAmount: 3500,
  });
});

Deno.test('dues › claimed and rejected payments never reduce the balance', () => {
  const entries = [credit(5000, '2026-10-21'), payment(2000, 'claimed'), payment(1000, 'rejected')];
  const dues = computeDues(entries, TODAY);
  assertEquals([dues.outstanding, dues.overdueAmount], [5000, 5000]);
});

Deno.test('dues › a fully paid book owes nothing and has no due date', () => {
  assertEquals(computeDues([credit(5000, '2026-10-21'), payment(5000)], TODAY), NO_DUES);
});

Deno.test('dues › paying more than was owed never makes the balance negative', () => {
  assertEquals(computeDues([credit(1000, '2026-10-21'), payment(1500)], TODAY), NO_DUES);
});

Deno.test('dues › days overdue follow the (demo) date passed in, not the real clock', () => {
  const entries = [credit(5000, '2026-10-21')];
  assertEquals(computeDues(entries, '2026-10-31').daysOverdue, 10);
  assertEquals(computeDues(entries, '2026-10-21').overdueAmount, 0);
});

Deno.test('dues › rupee amounts with paise add up exactly', () => {
  const dues = computeDues([credit(0.1, '2026-10-01'), credit(0.2, '2026-10-01')], TODAY);
  assertEquals(dues.outstanding, 0.3);
});

Deno.test('dues › a credit without a due date counts as due on the day it was given', () => {
  const undated: LedgerEntry = {
    ...credit(700, '2026-10-30'),
    dueDate: null,
    entryDate: '2026-10-30',
  };
  assertEquals(computeDues([undated], TODAY).daysOverdue, 3);
});
