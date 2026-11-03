// supabase/functions/_shared/ledger/score.test.ts
// Reliability score (SPEC §9, M5 Decision 9): paid on time 40, promises kept 30, current overdue
// 20, answers calls 10. Bands: Reliable 75+, Watch 50–74, Risky <50, New (<3 credits or <30 days).
import { assertEquals } from '@std/assert';
import type { LedgerEntry } from '../schemas/ledger.ts';
import type { CallStatus } from '../schemas/shopkeeper.ts';
import { bandFor, computeScore, type ScoreInputs, type ScorePromise } from './score.ts';

const TODAY = '2026-11-10';

function credit(amount: number, entryDate: string, dueDate: string): LedgerEntry {
  return { kind: 'credit', amount, entryDate, dueDate, status: 'confirmed' };
}

function payment(amount: number, entryDate: string): LedgerEntry {
  return { kind: 'payment', amount, entryDate, dueDate: null, status: 'confirmed' };
}

function promises(kept: number, broken: number): ScorePromise[] {
  return [
    ...Array.from({ length: kept }, () => ({ promiseDate: '2026-10-01', status: 'kept' as const })),
    ...Array.from(
      { length: broken },
      () => ({ promiseDate: '2026-10-01', status: 'broken' as const }),
    ),
  ];
}

/** Three old credits, all paid on time: a clean history with nothing overdue. */
const CLEAN: readonly LedgerEntry[] = [
  credit(1000, '2026-06-01', '2026-06-16'),
  payment(1000, '2026-06-10'),
  credit(1000, '2026-07-01', '2026-07-16'),
  payment(1000, '2026-07-16'),
  credit(1000, '2026-08-01', '2026-08-16'),
  payment(1000, '2026-08-12'),
];

function inputs(overrides: Partial<ScoreInputs> = {}): ScoreInputs {
  return { entries: CLEAN, promises: [], callStatuses: [], today: TODAY, ...overrides };
}

Deno.test('score › a clean history scores 100, Reliable, and the parts add up', () => {
  const score = computeScore(inputs());
  assertEquals(score.parts, {
    paidOnTime: 40,
    promisesKept: 30,
    currentOverdue: 20,
    answersCalls: 10,
  });
  assertEquals([score.score, score.band], [100, 'reliable']);
});

Deno.test('score › paid on time is the share of credits paid by their due date', () => {
  const entries = [
    credit(1000, '2026-06-01', '2026-06-16'),
    payment(1000, '2026-06-20'),
    ...CLEAN.slice(2),
    credit(500, '2026-10-01', '2026-10-16'),
    payment(500, '2026-10-30'),
  ];
  const score = computeScore(inputs({ entries }));
  assertEquals(score.facts.creditsJudged, 4);
  assertEquals(score.facts.creditsOnTime, 2);
  assertEquals(score.parts.paidOnTime, 20);
});

Deno.test('score › an unpaid credit past its due date counts as late; one not due yet is not judged', () => {
  const entries = [
    ...CLEAN,
    credit(900, '2026-10-20', '2026-11-04'),
    credit(800, '2026-11-01', '2026-11-16'),
  ];
  const score = computeScore(inputs({ entries }));
  assertEquals([score.facts.creditsJudged, score.facts.creditsOnTime], [4, 3]);
  assertEquals(score.parts.paidOnTime, 30);
});

Deno.test('score › a credit due today and still unpaid is not judged yet', () => {
  const entries = [...CLEAN, credit(900, '2026-10-26', TODAY)];
  assertEquals(computeScore(inputs({ entries })).facts.creditsJudged, 3);
});

Deno.test('score › credits paid early but due later count as on time', () => {
  const entries = [...CLEAN, credit(900, '2026-11-01', '2026-11-16'), payment(900, '2026-11-05')];
  const score = computeScore(inputs({ entries }));
  assertEquals([score.facts.creditsJudged, score.facts.creditsOnTime], [4, 4]);
});

Deno.test('score › credits due more than 6 months ago are left out', () => {
  const entries = [credit(1000, '2026-04-01', '2026-04-16'), payment(1000, '2026-05-30'), ...CLEAN];
  assertEquals(computeScore(inputs({ entries })).facts.creditsJudged, 3);
});

Deno.test('score › nothing judged yet gives full marks for that part', () => {
  const entries = [credit(1000, '2026-11-01', '2026-11-16')];
  const score = computeScore(inputs({ entries }));
  assertEquals([score.parts.paidOnTime, score.parts.promisesKept, score.parts.answersCalls], [
    40,
    30,
    10,
  ]);
});

Deno.test('score › promises kept is kept ÷ (kept + broken), last 6 months only', () => {
  const old: ScorePromise = { promiseDate: '2026-03-01', status: 'broken' };
  const score = computeScore(
    inputs({ promises: [...promises(1, 2), old, { promiseDate: '2026-10-01', status: 'open' }] }),
  );
  assertEquals([score.facts.promisesKept, score.facts.promisesBroken], [1, 2]);
  assertEquals(score.parts.promisesKept, 10);
});

Deno.test('score › current overdue: full at 0 days, zero at 60+, linear between', () => {
  const overdue = (dueDate: string): number =>
    computeScore(inputs({ entries: [...CLEAN, credit(500, '2026-01-01', dueDate)] })).parts
      .currentOverdue;
  assertEquals(overdue('2026-11-10'), 20);
  assertEquals(overdue('2026-10-11'), 10);
  assertEquals(overdue('2026-09-11'), 0);
  assertEquals(overdue('2026-07-01'), 0);
  assertEquals(overdue('2026-11-01'), 17);
});

Deno.test('score › answers calls is answered ÷ made; queued and live calls are not counted yet', () => {
  const callStatuses: CallStatus[] = [
    'completed',
    'completed',
    'declined',
    'missed',
    'queued',
    'ringing',
    'in_progress',
  ];
  const score = computeScore(inputs({ callStatuses }));
  assertEquals([score.facts.callsMade, score.facts.callsAnswered], [4, 2]);
  assertEquals(score.parts.answersCalls, 5);
});

Deno.test('score › Ramesh-like history lands in Watch', () => {
  const entries = [
    credit(5000, '2026-08-01', '2026-08-16'),
    payment(5000, '2026-08-20'),
    credit(3500, '2026-09-01', '2026-09-16'),
    payment(3500, '2026-09-15'),
    credit(5000, '2026-10-06', '2026-10-21'),
  ];
  const score = computeScore(
    inputs({ entries, promises: promises(1, 1), callStatuses: ['completed', 'missed'] }),
  );
  // on time 1 of 3 → 13; kept 1 of 2 → 15; 20 days overdue → 13; calls 1 of 2 → 5.
  assertEquals(score.parts, {
    paidOnTime: 13,
    promisesKept: 15,
    currentOverdue: 13,
    answersCalls: 5,
  });
  assertEquals([score.score, score.band], [46, 'risky']);
});

Deno.test('score › bands at their edges', () => {
  const history = { credits: 3, firstEntryDate: '2026-01-01', today: TODAY };
  assertEquals(bandFor(75, history), 'reliable');
  assertEquals(bandFor(74, history), 'watch');
  assertEquals(bandFor(50, history), 'watch');
  assertEquals(bandFor(49, history), 'risky');
});

Deno.test('score › New with fewer than 3 credits or under 30 days of history', () => {
  assertEquals(bandFor(90, { credits: 2, firstEntryDate: '2026-01-01', today: TODAY }), 'new');
  assertEquals(bandFor(90, { credits: 5, firstEntryDate: '2026-10-12', today: TODAY }), 'new');
  assertEquals(bandFor(90, { credits: 5, firstEntryDate: '2026-10-11', today: TODAY }), 'reliable');
  assertEquals(bandFor(90, { credits: 0, firstEntryDate: null, today: TODAY }), 'new');
  assertEquals(computeScore(inputs({ entries: CLEAN.slice(0, 4) })).band, 'new');
});

Deno.test('score › only confirmed entries count', () => {
  const entries: LedgerEntry[] = [
    ...CLEAN,
    credit(500, '2026-10-01', '2026-10-16'),
    { ...payment(500, '2026-10-10'), status: 'claimed' },
  ];
  assertEquals(computeScore(inputs({ entries })).facts.creditsOnTime, 3);
});

Deno.test('score › an empty book is New with full marks', () => {
  const score = computeScore(inputs({ entries: [] }));
  assertEquals([score.score, score.band], [100, 'new']);
});
