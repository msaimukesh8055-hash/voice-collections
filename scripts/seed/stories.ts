// scripts/seed/stories.ts
// Five more hand-written books with earlier calls, so Asha's call history (M7 B1) shows a
// different memory for each person Saim plays (Saim, 2026-11-07). FAKE data. Days are relative to
// the day the seed is applied. Each callback summary must pass the their-words sanitiser: no
// figures, no owner, no money or instruction words.
//   Sujatha (index 1): kept her last promise → Asha thanks her.
//   Saritha (index 2): disputes a bill → Asha stays careful, no pressure.
//   Radha   (index 3): kept a promise, then did not pick up last time → Asha says nothing of it.
//   Mohan   (index 4): two broken promises in a row, upset last time → firmer tone, never harsh.
//   Farooq  (index 9, Hindi): shop shut for a wedding → Asha is gentle.
import type { PaymentMode } from '../../supabase/functions/_shared/schemas/ledger.ts';
import type { Book, SeedEntry, SeedPastCall, SeedPromise } from './generate-seed.ts';

const TERM_DAYS = 15;
const CALL_SECONDS = 140;

/** [given on day, amount, payments as [day, amount, mode]]. */
type Credit = readonly [number, number, ReadonlyArray<readonly [number, number, PaymentMode]>];

/** A promise made on one of the story's calls (by its call id). */
interface StoryPromise {
  readonly amount: number;
  readonly day: number;
  readonly createdDay: number;
  readonly status: 'kept' | 'broken';
  readonly callId: string;
}

/** A past call without the shopkeeper id and language, which the story's shopkeeper supplies. */
type StoryCall = Omit<SeedPastCall, 'shopkeeperId' | 'language'>;

export interface Story {
  /** Index of the generated shopkeeper this story replaces the book of. */
  readonly index: number;
  readonly credits: readonly Credit[];
  readonly promises: readonly StoryPromise[];
  readonly calls: readonly StoryCall[];
}

function callId(story: number, call: number): string {
  return `ca5eed00-0000-4000-8000-0000000${String(story).padStart(2, '0')}${String(call).padStart(3, '0')}`;
}

const RULE_PROMISE = {
  path: 'rule',
  decision: 'check_promise',
  reasoning: 'Promise logged: check it on the promise date.',
  outcome: 'promise',
  signals: [],
} as const;

export const STORIES: readonly Story[] = [
  {
    index: 1,
    credits: [
      [-55, 5000, [[-42, 5000, 'upi']]],
      [-20, 6000, [[-3, 4000, 'upi']]],
      [-6, 4500, []],
    ],
    promises: [{ amount: 4000, day: -3, createdDay: -8, status: 'kept', callId: callId(1, 1) }],
    calls: [
      {
        id: callId(1, 1),
        day: -8,
        durationSeconds: CALL_SECONDS,
        callback: null,
        run: RULE_PROMISE,
      },
    ],
  },
  {
    index: 2,
    credits: [
      [-40, 3000, [[-28, 3000, 'cash']]],
      [-22, 7500, []],
      [-4, 2000, []],
    ],
    promises: [],
    calls: [
      {
        id: callId(2, 1),
        day: -6,
        durationSeconds: CALL_SECONDS,
        callback: { reason: 'dispute', summary: 'Says a bill is for goods she sent back' },
        run: {
          path: 'agent',
          decision: 'owner_should_call',
          reasoning: 'She disputes a bill; the owner should check the returned goods with her.',
          outcome: 'callback',
          signals: [],
        },
      },
    ],
  },
  {
    index: 3,
    credits: [
      [-50, 4000, [[-38, 4000, 'cash']]],
      [-30, 5000, [[-13, 3000, 'upi']]],
      [-10, 3500, []],
    ],
    promises: [{ amount: 3000, day: -13, createdDay: -16, status: 'kept', callId: callId(3, 1) }],
    calls: [
      {
        id: callId(3, 1),
        day: -16,
        durationSeconds: CALL_SECONDS,
        callback: null,
        run: RULE_PROMISE,
      },
      {
        id: callId(3, 2),
        day: -3,
        durationSeconds: 0,
        status: 'missed',
        identity: 'unknown',
        callback: null,
        run: {
          path: 'rule',
          decision: 'remind_again',
          reasoning: 'No answer: try again another day.',
          outcome: 'no_answer',
          signals: [],
        },
      },
    ],
  },
  {
    index: 4,
    credits: [
      [-60, 5000, [[-45, 5000, 'cash']]],
      [-35, 6000, []],
      [-25, 2000, []],
      [-5, 3000, []],
    ],
    promises: [
      { amount: 4000, day: -9, createdDay: -14, status: 'broken', callId: callId(4, 1) },
      { amount: 4000, day: -2, createdDay: -7, status: 'broken', callId: callId(4, 2) },
    ],
    calls: [
      {
        id: callId(4, 1),
        day: -14,
        durationSeconds: CALL_SECONDS,
        callback: null,
        run: RULE_PROMISE,
      },
      {
        id: callId(4, 2),
        day: -7,
        durationSeconds: CALL_SECONDS,
        callback: null,
        run: {
          path: 'agent',
          decision: 'check_promise',
          reasoning: 'Second promise after a broken one; he sounded annoyed. Check it on the date.',
          outcome: 'promise',
          signals: ['angry'],
        },
      },
    ],
  },
  {
    index: 9,
    credits: [
      [-45, 4500, [[-30, 4500, 'upi']]],
      [-28, 5500, []],
      [-9, 2500, []],
    ],
    promises: [],
    calls: [
      {
        id: callId(9, 1),
        day: -5,
        durationSeconds: CALL_SECONDS,
        callback: { reason: 'hardship', summary: 'Said the shop was shut for a wedding last week' },
        run: {
          path: 'agent',
          decision: 'owner_should_call',
          reasoning: 'The shop was closed for a wedding; a call from the owner may help.',
          outcome: 'callback',
          signals: ['hardship'],
        },
      },
    ],
  },
];

function creditEntries(id: string, [day, amount, paid]: Credit): SeedEntry[] {
  const credit: SeedEntry = {
    shopkeeperId: id,
    kind: 'credit',
    amount,
    day,
    dueDay: day + TERM_DAYS,
    status: 'confirmed',
    mode: null,
  };
  const payments = paid.map(([payDay, payAmount, mode]): SeedEntry => ({
    shopkeeperId: id,
    kind: 'payment',
    amount: payAmount,
    day: payDay,
    dueDay: null,
    status: 'confirmed',
    mode,
  }));
  return [credit, ...payments];
}

export function storyBook(story: Story, id: string): Book {
  const entries = story.credits.flatMap((credit) => creditEntries(id, credit));
  const promises = story.promises.map((promise): SeedPromise => ({ ...promise, shopkeeperId: id }));
  return { entries, promises };
}

export function storyPastCalls(
  story: Story,
  shopkeeper: { readonly id: string; readonly language: SeedPastCall['language'] },
): readonly SeedPastCall[] {
  return story.calls.map((call): SeedPastCall => ({
    ...call,
    shopkeeperId: shopkeeper.id,
    language: shopkeeper.language,
  }));
}
