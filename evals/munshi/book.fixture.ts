// evals/munshi/book.fixture.ts
// The fake book Munshi's text evals run on (M8 C1). FAKE DATA ONLY: Srinivas Reddy's 12
// shopkeepers on Saturday 7 Nov 2026, with what the 15 scenarios need:
//   - Ramesh (Ramesh Kirana): ₹9,000 pending, two equal ₹5,000 credits (6 Oct, 24 Oct), a
//     ₹1,000 payment on 3 Nov (his newest entry), an open ₹2,000 UPI claim, and two Asha calls
//     (30 Oct: promised ₹3,000 by 6 Nov, broken; 4 Nov: money is tight, the claim)
//   - two Sureshes (Suresh Fancy Store ₹3,200; Suresh Tea Stall ₹750 overdue)
//   - Latha with an open ₹1,500 cash claim; two shopkeepers due today; an open and a broken promise
// Tools run on it in-process through the same owner-tools registry as munshi-tools, with the
// same in-memory repositories the Edge Function tests use (owner-tools/__fixtures__/context.ts).
// Each scenario gets a fresh copy, so one scenario's changes never reach another.
import type {
  BookEntry,
  BookShopkeeper,
} from '../../supabase/functions/_shared/db/book-repository.ts';
import { fakeOwnerCall } from '../../supabase/functions/_shared/db/fake-owner-call-repository.ts';
import type {
  FakePastCall,
  FakePromiseRecord,
} from '../../supabase/functions/_shared/db/fake-repository.ts';
import {
  type CountedContext,
  ownerContext,
} from '../../supabase/functions/_shared/owner-tools/__fixtures__/context.ts';
import type { OwnerToolContext } from '../../supabase/functions/_shared/owner-tools/types.ts';
import type { PaymentMode } from '../../supabase/functions/_shared/schemas/ledger.ts';

/** The demo day of every eval: Saturday, 7 Nov 2026 (India). */
export const EVAL_TODAY = '2026-11-07';
/** Noon IST on EVAL_TODAY: when each simulated conversation starts. */
export const EVAL_START = new Date('2026-11-07T12:00:00+05:30');
/** Start call was pressed this long before the conversation (well before the wrap-up note). */
const DEFAULT_ACCEPTED_AGO_MS = 30_000;

const SHOPKEEPER_ID_PREFIX = 'e7a10000-0000-4000-8000-';
const ENTRY_ID_PREFIX = 'e7a1e000-0000-4000-8000-';
const CALL_ID_PREFIX = 'e7a1c000-0000-4000-8000-';
const PROMISE_ID_PREFIX = 'e7a1f000-0000-4000-8000-';

function idOf(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(12, '0')}`;
}

type ShopNames = Pick<BookShopkeeper, 'name' | 'shopName' | 'area'>;

function shop(n: number, names: ShopNames): BookShopkeeper {
  return { id: idOf(SHOPKEEPER_ID_PREFIX, n), ...names, language: 'te' };
}

export const RAMESH = shop(1, { name: 'Ramesh', shopName: 'Ramesh Kirana', area: 'Old Town' });
export const SURESH_FANCY = shop(2, {
  name: 'Suresh',
  shopName: 'Suresh Fancy Store',
  area: 'Old Town',
});
export const SURESH_TEA = shop(3, {
  name: 'Suresh',
  shopName: 'Suresh Tea Stall',
  area: 'Kamala Nagar',
});
export const LATHA = shop(4, {
  name: 'Latha',
  shopName: 'Latha General Stores',
  area: 'Gandhi Bazaar',
});
const PRAVEEN = shop(5, { name: 'Praveen', shopName: 'Praveen Bakery', area: 'Sai Nagar' });
const KAVITHA = shop(6, { name: 'Kavitha', shopName: 'Kavitha Tiffins', area: 'RTC Colony' });
const VENKATESH = shop(7, {
  name: 'Venkatesh',
  shopName: 'Venkatesh Provisions',
  area: 'Ram Nagar',
});
const ANJALI = shop(8, { name: 'Anjali', shopName: 'Anjali Fancy', area: 'Sai Nagar' });
const MAHESH = shop(9, { name: 'Mahesh', shopName: 'Mahesh Mobiles', area: 'Clock Tower' });
const FATIMA = shop(10, { name: 'Fatima', shopName: 'Fatima Stores', area: 'Old Town' });
export const GOPAL = shop(11, { name: 'Gopal', shopName: 'Gopal Kirana', area: 'Kamala Nagar' });
const NARAYANA = shop(12, {
  name: 'Narayana',
  shopName: 'Narayana Rice Depot',
  area: 'Market Yard',
});

export const EVAL_SHOPKEEPERS: readonly BookShopkeeper[] = [
  RAMESH,
  SURESH_FANCY,
  SURESH_TEA,
  LATHA,
  PRAVEEN,
  KAVITHA,
  VENKATESH,
  ANJALI,
  MAHESH,
  FATIMA,
  GOPAL,
  NARAYANA,
];

interface EntryFields {
  readonly shopkeeper: BookShopkeeper;
  readonly kind: 'credit' | 'payment';
  readonly amount: number;
  readonly entryDate: string;
  readonly dueDate?: string;
  readonly status?: BookEntry['status'];
  readonly paymentMode?: PaymentMode;
}

function entry(n: number, fields: EntryFields): BookEntry {
  return {
    id: idOf(ENTRY_ID_PREFIX, n),
    shopkeeperId: fields.shopkeeper.id,
    kind: fields.kind,
    amount: fields.amount,
    entryDate: fields.entryDate,
    dueDate: fields.dueDate ?? null,
    status: fields.status ?? 'confirmed',
    paymentMode: fields.paymentMode ?? (fields.kind === 'payment' ? 'cash' : null),
    createdAt: `${fields.entryDate}T05:00:00.000Z`,
  };
}

/** Ramesh's older ₹5,000 credit (6 Oct) and the equal newer one (24 Oct). */
export const RAMESH_OLD_5000_ID = idOf(ENTRY_ID_PREFIX, 3);
export const RAMESH_NEW_5000_ID = idOf(ENTRY_ID_PREFIX, 4);
/** Ramesh's newest live entry: ₹1,000 paid on 3 Nov. */
export const RAMESH_LAST_ENTRY_ID = idOf(ENTRY_ID_PREFIX, 5);
/** Ramesh's pending balance on EVAL_TODAY (two ₹5,000 credits less ₹1,000 paid; the claim does
 * not count). The fixture test checks it against computeDues. */
export const RAMESH_OUTSTANDING = 9000;
export const RAMESH_CLAIM_ID = idOf(ENTRY_ID_PREFIX, 6);
export const LATHA_CLAIM_ID = idOf(ENTRY_ID_PREFIX, 9);

export const EVAL_ENTRIES: readonly BookEntry[] = [
  entry(1, {
    shopkeeper: RAMESH,
    kind: 'credit',
    amount: 4000,
    entryDate: '2026-09-05',
    dueDate: '2026-09-20',
  }),
  entry(2, { shopkeeper: RAMESH, kind: 'payment', amount: 4000, entryDate: '2026-09-24' }),
  entry(3, {
    shopkeeper: RAMESH,
    kind: 'credit',
    amount: 5000,
    entryDate: '2026-10-06',
    dueDate: '2026-10-21',
  }),
  entry(4, {
    shopkeeper: RAMESH,
    kind: 'credit',
    amount: 5000,
    entryDate: '2026-10-24',
    dueDate: '2026-11-08',
  }),
  entry(5, { shopkeeper: RAMESH, kind: 'payment', amount: 1000, entryDate: '2026-11-03' }),
  entry(6, {
    shopkeeper: RAMESH,
    kind: 'payment',
    amount: 2000,
    entryDate: '2026-11-01',
    status: 'claimed',
    paymentMode: 'upi',
  }),
  entry(7, {
    shopkeeper: SURESH_FANCY,
    kind: 'credit',
    amount: 3200,
    entryDate: '2026-10-28',
    dueDate: '2026-11-12',
  }),
  entry(8, {
    shopkeeper: LATHA,
    kind: 'credit',
    amount: 2000,
    entryDate: '2026-10-10',
    dueDate: '2026-10-25',
  }),
  entry(9, {
    shopkeeper: LATHA,
    kind: 'payment',
    amount: 1500,
    entryDate: '2026-11-05',
    status: 'claimed',
    paymentMode: 'cash',
  }),
  entry(10, {
    shopkeeper: SURESH_TEA,
    kind: 'credit',
    amount: 750,
    entryDate: '2026-10-15',
    dueDate: '2026-10-30',
  }),
  entry(11, {
    shopkeeper: PRAVEEN,
    kind: 'credit',
    amount: 1500,
    entryDate: '2026-10-05',
    dueDate: '2026-10-20',
  }),
  entry(12, { shopkeeper: PRAVEEN, kind: 'payment', amount: 1500, entryDate: '2026-11-01' }),
  entry(13, {
    shopkeeper: KAVITHA,
    kind: 'credit',
    amount: 6000,
    entryDate: '2026-10-23',
    dueDate: '2026-11-07',
  }),
  entry(14, {
    shopkeeper: VENKATESH,
    kind: 'credit',
    amount: 12500,
    entryDate: '2026-09-20',
    dueDate: '2026-10-05',
  }),
  entry(15, {
    shopkeeper: ANJALI,
    kind: 'credit',
    amount: 1800,
    entryDate: '2026-10-28',
    dueDate: '2026-11-12',
  }),
  entry(16, {
    shopkeeper: MAHESH,
    kind: 'credit',
    amount: 4200,
    entryDate: '2026-10-17',
    dueDate: '2026-11-01',
  }),
  entry(17, {
    shopkeeper: FATIMA,
    kind: 'credit',
    amount: 2500,
    entryDate: '2026-10-23',
    dueDate: '2026-11-07',
  }),
  entry(18, {
    shopkeeper: GOPAL,
    kind: 'credit',
    amount: 900,
    entryDate: '2026-11-05',
    dueDate: '2026-11-20',
  }),
  entry(19, {
    shopkeeper: NARAYANA,
    kind: 'credit',
    amount: 7000,
    entryDate: '2026-09-30',
    dueDate: '2026-10-15',
  }),
];

function promise(
  n: number,
  shopkeeper: BookShopkeeper,
  fields: Pick<FakePromiseRecord, 'amount' | 'promiseDate' | 'status' | 'createdAt'>,
): FakePromiseRecord {
  return { id: idOf(PROMISE_ID_PREFIX, n), shopkeeperId: shopkeeper.id, ...fields };
}

const RAMESH_PROMISE = promise(1, RAMESH, {
  amount: 3000,
  promiseDate: '2026-11-06',
  status: 'broken',
  createdAt: '2026-10-30T05:35:00.000Z',
});

export const EVAL_PROMISES: readonly FakePromiseRecord[] = [
  RAMESH_PROMISE,
  promise(2, MAHESH, {
    amount: 4200,
    promiseDate: '2026-11-09',
    status: 'open',
    createdAt: '2026-11-04T06:00:00.000Z',
  }),
  promise(3, NARAYANA, {
    amount: 3000,
    promiseDate: '2026-11-03',
    status: 'broken',
    createdAt: '2026-10-27T06:00:00.000Z',
  }),
];

function pastCall(
  n: number,
  fields: Partial<FakePastCall> & Pick<FakePastCall, 'shopkeeperId' | 'queuedAt'>,
): FakePastCall {
  return {
    id: idOf(CALL_ID_PREFIX, n),
    mode: 'live',
    status: 'completed',
    identityStatus: 'confirmed',
    promises: [],
    claims: [],
    followups: [],
    signals: [],
    ...fields,
  };
}

export const EVAL_PAST_CALLS: readonly FakePastCall[] = [
  pastCall(1, {
    shopkeeperId: RAMESH.id,
    queuedAt: '2026-11-04T05:30:00.000Z',
    claims: [{ amount: 2000, paidDate: '2026-11-01', mode: 'upi', status: 'claimed' }],
    followups: [
      { kind: 'owner_callback', reason: 'hardship', summary: 'Said money is tight this week' },
    ],
  }),
  pastCall(2, {
    shopkeeperId: RAMESH.id,
    queuedAt: '2026-10-30T05:30:00.000Z',
    promises: [RAMESH_PROMISE],
  }),
  pastCall(3, {
    shopkeeperId: LATHA.id,
    queuedAt: '2026-11-05T06:00:00.000Z',
    mode: 'simulated',
    claims: [{ amount: 1500, paidDate: '2026-11-05', mode: 'cash', status: 'claimed' }],
  }),
];

export interface EvalBookOptions {
  /** How long before EVAL_START the call was accepted (default 30 s; 7:10 for the wrap-up). */
  readonly acceptedAgoMs?: number;
}

export interface EvalBook {
  /** The owner-tool context at the simulated time of one tool call. */
  readonly contextAt: (realNow: Date) => OwnerToolContext;
  /** Live state of the fake book, voice actions, queued reminders and send kicks. */
  readonly state: Pick<CountedContext, 'book' | 'actions' | 'queued' | 'kicked'>;
}

/** A fresh copy of the eval book for one scenario. */
export function createEvalBook(options: EvalBookOptions = {}): EvalBook {
  const acceptedAgo = options.acceptedAgoMs ?? DEFAULT_ACCEPTED_AGO_MS;
  const acceptedAt = new Date(EVAL_START.getTime() - acceptedAgo).toISOString();
  const context = ownerContext({
    shopkeepers: EVAL_SHOPKEEPERS,
    entries: EVAL_ENTRIES,
    promises: EVAL_PROMISES,
    alertPromises: EVAL_PROMISES,
    pastCalls: EVAL_PAST_CALLS,
    callStatuses: { [RAMESH.id]: ['completed', 'completed'], [LATHA.id]: ['completed'] },
    today: EVAL_TODAY,
    realNow: EVAL_START,
    ownerCall: fakeOwnerCall({ acceptedAt, issuedAt: acceptedAt }),
  });
  return {
    contextAt: (realNow) => ({ ...context.ctx, realNow }),
    state: {
      book: context.book,
      actions: context.actions,
      queued: context.queued,
      kicked: context.kicked,
    },
  };
}
