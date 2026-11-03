// supabase/functions/_shared/ledger/cleared.test.ts
import { assertEquals } from '@std/assert';
import type { LedgerEntry } from '../schemas/ledger.ts';
import { clearedCredits } from './cleared.ts';

function credit(amount: number, entryDate: string, dueDate: string): LedgerEntry {
  return { kind: 'credit', amount, entryDate, dueDate, status: 'confirmed' };
}

function payment(
  amount: number,
  entryDate: string,
  status: LedgerEntry['status'] = 'confirmed',
): LedgerEntry {
  return { kind: 'payment', amount, entryDate, dueDate: null, status };
}

Deno.test('cleared › a credit is cleared on the day of the payment that finished it', () => {
  const entries = [
    credit(4000, '2026-09-05', '2026-09-20'),
    payment(1500, '2026-09-10'),
    payment(2500, '2026-09-24'),
  ];
  assertEquals(clearedCredits(entries), [
    { amount: 4000, entryDate: '2026-09-05', dueDate: '2026-09-20', clearedOn: '2026-09-24' },
  ]);
});

Deno.test('cleared › payments clear the oldest credit first and one payment can clear two', () => {
  const entries = [
    credit(2000, '2026-10-10', '2026-10-25'),
    credit(1000, '2026-10-01', '2026-10-16'),
    payment(3000, '2026-11-01'),
  ];
  assertEquals(clearedCredits(entries).map((c) => c.amount), [1000, 2000]);
});

Deno.test('cleared › part-paid credits and claimed payments do not count', () => {
  const entries = [
    credit(5000, '2026-10-06', '2026-10-21'),
    payment(2000, '2026-10-20'),
    payment(3000, '2026-11-01', 'claimed'),
  ];
  assertEquals(clearedCredits(entries), []);
});
