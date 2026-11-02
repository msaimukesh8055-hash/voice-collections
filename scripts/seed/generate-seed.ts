// scripts/seed/generate-seed.ts
// Builds the demo credit book (M3 Decision 7): 1 owner, 100 FAKE shopkeepers, 6 months of
// credits, payments and promises. A fixed random seed means the same input always gives the same
// file. Each shopkeeper has a behaviour profile (reliable / watch / risky / new) that drives how
// late they pay and whether they keep promises, so M5's score lands across all bands.
// Days are offsets from "today"; the SQL turns them into dates when the seed is applied.
import type { PaymentMode } from '../../supabase/functions/_shared/schemas/ledger.ts';
import type { Language } from '../../supabase/functions/_shared/schemas/shopkeeper.ts';
import { AREAS, FIRST_NAMES, RAMESH, SHOP_WORDS } from './names.ts';
import { createRandom, type Random } from './random.ts';
import { rameshBook } from './ramesh.ts';

export const SEED_NUMBER = 20261102;
export const SHOPKEEPER_COUNT = 100;
export const HISTORY_DAYS = 180;
export const CREDIT_TERM_DAYS = 15;

export const PROFILES = ['reliable', 'watch', 'risky', 'new'] as const;
export type Profile = (typeof PROFILES)[number];
export const PROFILE_COUNTS: Readonly<Record<Profile, number>> = {
  reliable: 40,
  watch: 30,
  risky: 20,
  new: 10,
};

/** Persona the simulated shopkeeper plays in M5, from the behaviour profile. */
const PERSONAS: Readonly<Record<Profile, string>> = {
  reliable: 'cooperative',
  watch: 'slow_payer',
  risky: 'avoids_commitment',
  new: 'new_customer',
};

export interface SeedShopkeeper {
  readonly id: string;
  readonly name: string;
  readonly shopName: string;
  readonly area: string;
  readonly phone: string;
  readonly language: Language;
  readonly persona: string;
  readonly profile: Profile;
}

export interface SeedEntry {
  readonly shopkeeperId: string;
  readonly kind: 'credit' | 'payment';
  readonly amount: number;
  readonly day: number;
  readonly dueDay: number | null;
  readonly status: 'confirmed' | 'claimed' | 'rejected';
  readonly mode: PaymentMode | null;
}

/** 'last_friday' = the most recent Friday before the day the seed is applied (Ramesh's story). */
export type PromiseDay = number | 'last_friday';

export interface SeedPromise {
  readonly shopkeeperId: string;
  readonly amount: number;
  readonly day: PromiseDay;
  readonly createdDay: number;
  readonly status: 'open' | 'kept' | 'broken';
}

export interface Book {
  readonly entries: readonly SeedEntry[];
  readonly promises: readonly SeedPromise[];
}

export interface SeedData extends Book {
  readonly shopkeepers: readonly SeedShopkeeper[];
}

const LATENESS: Readonly<Record<Profile, readonly [number, number]>> = {
  reliable: [-5, 2],
  watch: [0, 20],
  risky: [10, 55],
  new: [-3, 10],
};
const NEVER_PAID_CHANCE: Readonly<Record<Profile, number>> = {
  reliable: 0,
  watch: 0.05,
  risky: 0.25,
  new: 0,
};
const PROMISE_CHANCE: Readonly<Record<Profile, number>> = {
  reliable: 0.3,
  watch: 0.5,
  risky: 0.6,
  new: 0.3,
};
const SPLIT_PAYMENT_CHANCE = 0.25;
const PAYMENT_MODES: readonly PaymentMode[] = [
  'cash',
  'cash',
  'upi',
  'upi',
  'upi',
  'bank_transfer',
  'cheque',
];
const AMOUNT_STEP = 500;
const LANGUAGE_WEIGHTS: readonly Language[] = [
  ...Array<Language>(15).fill('te'),
  'hi',
  'hi',
  'hi',
  'en',
  'en',
];

export function shopkeeperId(index: number): string {
  return `5e000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

/** +91 00000 xxxxx: no real Indian number starts with 0 after the country code. */
export function fakePhone(index: number): string {
  return `+91 00000 ${String(index + 1).padStart(5, '0')}`;
}

/** Ramesh is index 0 ('watch'); the rest of the profiles are shuffled over indices 1–99. */
function assignProfiles(random: Random): readonly Profile[] {
  const counts = { ...PROFILE_COUNTS, watch: PROFILE_COUNTS.watch - 1 };
  const pool = PROFILES.flatMap((profile) => Array<Profile>(counts[profile]).fill(profile));
  return ['watch', ...random.shuffle(pool)];
}

function nameShopkeeper(
  random: Random,
  taken: ReadonlySet<string>,
): Pick<SeedShopkeeper, 'name' | 'shopName' | 'language'> {
  for (;;) {
    const language = random.pick(LANGUAGE_WEIGHTS);
    const name = random.pick(FIRST_NAMES[language]);
    const shopName = `${name} ${random.pick(SHOP_WORDS)}`;
    if (!taken.has(shopName)) return { name, shopName, language };
  }
}

function buildShopkeepers(random: Random): readonly SeedShopkeeper[] {
  const profiles = assignProfiles(random);
  const taken = new Set<string>([RAMESH.shopName]);
  return profiles.map((profile, index): SeedShopkeeper => {
    const named =
      index === 0 ? { ...RAMESH, language: 'te' as const } : nameShopkeeper(random, taken);
    taken.add(named.shopName);
    const area = index === 0 ? RAMESH.area : random.pick(AREAS);
    return {
      id: shopkeeperId(index),
      name: named.name,
      shopName: named.shopName,
      area,
      phone: fakePhone(index),
      language: named.language,
      persona: PERSONAS[profile],
      profile,
    };
  });
}

interface CreditPlan {
  readonly day: number;
  readonly amount: number;
  readonly payDay: number;
}

function payments(shopkeeper: SeedShopkeeper, credit: CreditPlan, random: Random): SeedEntry[] {
  if (credit.payDay > -1) return [];
  const base = {
    shopkeeperId: shopkeeper.id,
    kind: 'payment',
    dueDay: null,
    status: 'confirmed',
  } as const;
  if (!random.chance(SPLIT_PAYMENT_CHANCE) || credit.amount < 2 * AMOUNT_STEP) {
    return [
      { ...base, amount: credit.amount, day: credit.payDay, mode: random.pick(PAYMENT_MODES) },
    ];
  }
  const first = Math.round(credit.amount / 2 / AMOUNT_STEP) * AMOUNT_STEP;
  const firstDay = Math.max(credit.day + 1, credit.payDay - random.int(2, 6));
  return [
    { ...base, amount: first, day: firstDay, mode: random.pick(PAYMENT_MODES) },
    {
      ...base,
      amount: credit.amount - first,
      day: credit.payDay,
      mode: random.pick(PAYMENT_MODES),
    },
  ];
}

function promiseStatus(credit: CreditPlan, promiseDay: number): SeedPromise['status'] {
  if (credit.payDay <= -1 && credit.payDay <= promiseDay) return 'kept';
  return promiseDay >= 0 ? 'open' : 'broken';
}

/** A late payer sometimes promised a date a few days after the due date. */
function maybePromise(
  shopkeeper: SeedShopkeeper,
  credit: CreditPlan,
  random: Random,
): SeedPromise | null {
  const createdDay = credit.day + CREDIT_TERM_DAYS + 3;
  const isLate = credit.payDay > createdDay;
  if (createdDay > -1 || !isLate || !random.chance(PROMISE_CHANCE[shopkeeper.profile])) return null;
  const day = createdDay + random.int(2, 7);
  return {
    shopkeeperId: shopkeeper.id,
    amount: credit.amount,
    day,
    createdDay,
    status: promiseStatus(credit, day),
  };
}

function planCredit(shopkeeper: SeedShopkeeper, day: number, random: Random): CreditPlan {
  const [early, late] = LATENESS[shopkeeper.profile];
  const neverPaid = random.chance(NEVER_PAID_CHANCE[shopkeeper.profile]);
  const dueDay = day + CREDIT_TERM_DAYS;
  const payDay = neverPaid
    ? Number.POSITIVE_INFINITY
    : Math.max(day + 1, dueDay + random.int(early, late));
  return { day, amount: random.int(2, 24) * AMOUNT_STEP, payDay };
}

/** Only one open promise per shopkeeper: later ones would replace it anyway. */
function keepOneOpen(promises: readonly SeedPromise[]): readonly SeedPromise[] {
  const openIndexes = promises.flatMap((promise, index) =>
    promise.status === 'open' ? [index] : [],
  );
  const lastOpen = openIndexes.at(-1) ?? -1;
  return promises.filter((promise, index) => promise.status !== 'open' || index === lastOpen);
}

function generateBook(shopkeeper: SeedShopkeeper, random: Random): Book {
  const start =
    shopkeeper.profile === 'new' ? -random.int(30, 45) : -HISTORY_DAYS + random.int(0, 10);
  const entries: SeedEntry[] = [];
  const promises: SeedPromise[] = [];
  for (let day = start; day <= -1; day += random.int(10, 21)) {
    const credit = planCredit(shopkeeper, day, random);
    entries.push({
      shopkeeperId: shopkeeper.id,
      kind: 'credit',
      amount: credit.amount,
      day,
      dueDay: day + CREDIT_TERM_DAYS,
      status: 'confirmed',
      mode: null,
    });
    entries.push(...payments(shopkeeper, credit, random));
    const promise = maybePromise(shopkeeper, credit, random);
    if (promise) promises.push(promise);
  }
  return { entries, promises: keepOneOpen(promises) };
}

export function outstandingOf(entries: readonly SeedEntry[], id: string): number {
  return entries
    .filter((entry) => entry.shopkeeperId === id && entry.status === 'confirmed')
    .reduce((sum, entry) => sum + (entry.kind === 'credit' ? entry.amount : -entry.amount), 0);
}

const CLAIMED_COUNT = 3;
const CLAIM_DAY = -2;
const REJECTED = { day: -20, amount: 1000 } as const;

/** A few "I already paid" claims waiting for the owner (and one he rejected), for M5's cards. */
function claims(
  shopkeepers: readonly SeedShopkeeper[],
  entries: readonly SeedEntry[],
): SeedEntry[] {
  const owing = shopkeepers
    .slice(1)
    .filter((s) => s.profile !== 'reliable' && outstandingOf(entries, s.id) >= 2 * AMOUNT_STEP);
  const base = { kind: 'payment', dueDay: null, mode: 'upi' } as const;
  const claimed = owing.slice(0, CLAIMED_COUNT).map((s): SeedEntry => ({
    ...base,
    shopkeeperId: s.id,
    amount: AMOUNT_STEP * 2,
    day: CLAIM_DAY,
    status: 'claimed',
  }));
  const rejectedFor = owing[CLAIMED_COUNT];
  const rejected: SeedEntry[] = rejectedFor
    ? [
        {
          ...base,
          shopkeeperId: rejectedFor.id,
          amount: REJECTED.amount,
          day: REJECTED.day,
          status: 'rejected',
        },
      ]
    : [];
  return [...claimed, ...rejected];
}

export function generateSeed(seed: number = SEED_NUMBER): SeedData {
  const random = createRandom(seed);
  const shopkeepers = buildShopkeepers(random);
  const [ramesh, ...others] = shopkeepers;
  const books = [
    rameshBook(ramesh?.id ?? shopkeeperId(0)),
    ...others.map((shopkeeper) => generateBook(shopkeeper, random)),
  ];
  const entries = books.flatMap((book) => book.entries);
  return {
    shopkeepers,
    entries: [...entries, ...claims(shopkeepers, entries)],
    promises: books.flatMap((book) => book.promises),
  };
}
