// scripts/seed/ramesh.ts
// Ramesh Kirana's book, written by hand for the demo story (M3 Decision 7). FAKE data.
// Today: ₹8,500 outstanding = ₹5,000 overdue 12 days + ₹3,500 due in 3 days, and a ₹3,000
// promise for "last Friday" that was broken (M5's memory line). One earlier promise was kept,
// so the tone ladder starts at level 2 (one broken promise), not 3.
// M7 B1 (Decision 4): two earlier calls, so Asha's first demo call already has a history: day -10
// (the ₹3,000 promise was made on it) and day -4 (money is tight: a hardship callback).
import type { PaymentMode } from '../../supabase/functions/_shared/schemas/ledger.ts';
import type { Book, SeedEntry, SeedPastCall, SeedPromise } from './generate-seed.ts';

const TERM_DAYS = 15;

/** [given on day, amount, payments as [day, amount, mode]] — days relative to today. */
const CREDITS: ReadonlyArray<
  readonly [number, number, ReadonlyArray<readonly [number, number, PaymentMode]>]
> = [
  [-172, 4000, [[-158, 4000, 'cash']]],
  [-150, 6500, [[-127, 6500, 'upi']]],
  [-125, 3000, [[-111, 3000, 'cash']]],
  [
    -100,
    5500,
    [
      [-80, 3000, 'upi'],
      [-72, 2500, 'cash'],
    ],
  ],
  [-70, 4500, [[-50, 4500, 'upi']]],
  [-45, 3500, [[-31, 3500, 'cash']]],
  [-27, 5000, []],
  [-12, 3500, []],
];

/** Fixed ids so the broken promise can point at its call. */
export const RAMESH_PROMISE_CALL_ID = 'ca5eed00-0000-4000-8000-000000000001';
export const RAMESH_HARDSHIP_CALL_ID = 'ca5eed00-0000-4000-8000-000000000002';
/** Asha's callback summary on day -4. It must not name the owner or a figure, or the
 * their-words sanitiser drops it (M7 B1 Decision 1). */
export const RAMESH_HARDSHIP_SUMMARY = 'Said harvest money comes next week';
const CALL_SECONDS = 150;

export const RAMESH_STORY = {
  outstanding: 8500,
  overdueAmount: 5000,
  daysOverdue: 12,
  nextDueAmount: 3500,
  nextDueInDays: 3,
  brokenPromiseAmount: 3000,
} as const;

export function rameshBook(id: string): Book {
  const entries = CREDITS.flatMap(([day, amount, paid]): SeedEntry[] => [
    {
      shopkeeperId: id,
      kind: 'credit',
      amount,
      day,
      dueDay: day + TERM_DAYS,
      status: 'confirmed',
      mode: null,
    },
    ...paid.map(([payDay, payAmount, mode]): SeedEntry => ({
      shopkeeperId: id,
      kind: 'payment',
      amount: payAmount,
      day: payDay,
      dueDay: null,
      status: 'confirmed',
      mode,
    })),
  ]);
  const promises: SeedPromise[] = [
    { shopkeeperId: id, amount: 2500, day: -72, createdDay: -80, status: 'kept' },
    {
      shopkeeperId: id,
      amount: RAMESH_STORY.brokenPromiseAmount,
      day: 'last_friday',
      createdDay: -10,
      status: 'broken',
      callId: RAMESH_PROMISE_CALL_ID,
    },
  ];
  return { entries, promises };
}

export function rameshPastCalls(id: string): readonly SeedPastCall[] {
  return [
    {
      id: RAMESH_PROMISE_CALL_ID,
      shopkeeperId: id,
      day: -10,
      language: 'te',
      durationSeconds: CALL_SECONDS,
      callback: null,
      run: {
        path: 'rule',
        decision: 'check_promise',
        reasoning: 'Promise logged: check it on the promise date.',
        outcome: 'promise',
        signals: [],
      },
    },
    {
      id: RAMESH_HARDSHIP_CALL_ID,
      shopkeeperId: id,
      day: -4,
      language: 'te',
      durationSeconds: CALL_SECONDS,
      callback: { reason: 'hardship', summary: RAMESH_HARDSHIP_SUMMARY },
      run: {
        path: 'agent',
        decision: 'owner_should_call',
        reasoning: 'Money is tight until the harvest is sold; a call from the owner may help.',
        outcome: 'callback',
        signals: ['hardship'],
      },
    },
  ];
}
