// supabase/functions/_shared/calls/tone.test.ts
// Tone ladder (SPEC §7.4, M5 Decision 2): worked out in code, never by Asha.
import { assertEquals } from '@std/assert';
import type { PromiseRecord } from '../ledger/promise-check.ts';
import { consequenceFor, countRecentBroken, toneLevel } from './tone.ts';

const TODAY = '2026-11-10';

function promise(id: string, promiseDate: string, status: PromiseRecord['status']): PromiseRecord {
  return { id, amount: 1000, promiseDate, status, createdAt: '2026-01-01T00:00:00Z' };
}

Deno.test('tone › no broken promise and under 15 days overdue is level 1', () => {
  assertEquals(toneLevel({ brokenPromises: 0, daysOverdue: 0 }), 1);
  assertEquals(toneLevel({ brokenPromises: 0, daysOverdue: 14 }), 1);
});

Deno.test('tone › one broken promise or 15+ days overdue is level 2', () => {
  assertEquals(toneLevel({ brokenPromises: 1, daysOverdue: 0 }), 2);
  assertEquals(toneLevel({ brokenPromises: 0, daysOverdue: 15 }), 2);
  assertEquals(toneLevel({ brokenPromises: 1, daysOverdue: 29 }), 2);
});

Deno.test('tone › two broken promises or 30+ days overdue is level 3', () => {
  assertEquals(toneLevel({ brokenPromises: 2, daysOverdue: 0 }), 3);
  assertEquals(toneLevel({ brokenPromises: 0, daysOverdue: 30 }), 3);
  assertEquals(toneLevel({ brokenPromises: 5, daysOverdue: 90 }), 3);
});

Deno.test('tone › counts broken promises of the last 6 months only', () => {
  const promises = [
    promise('a', '2026-10-30', 'broken'),
    promise('b', '2026-05-13', 'broken'),
    promise('c', '2026-05-12', 'broken'),
    promise('d', '2026-10-01', 'kept'),
    promise('e', '2026-10-02', 'replaced'),
    promise('f', '2026-11-20', 'broken'),
  ];
  assertEquals(countRecentBroken(promises, TODAY), 2);
});

Deno.test('tone › the consequence is said only at level 3 and only if the owner set one', () => {
  const text = 'New stock on credit is paused until this is cleared.';
  assertEquals(consequenceFor(3, text), text);
  assertEquals(consequenceFor(2, text), null);
  assertEquals(consequenceFor(1, text), null);
  assertEquals(consequenceFor(3, null), null);
  assertEquals(consequenceFor(3, '   '), null);
});
