// supabase/functions/_shared/ledger/due-alert.ts
// Who the owner's due alert lists (SPEC §6.4, M5 5b): people who broke a promise in the last
// 14 days, people overdue, and people with a credit due today. Each person appears once, in the
// first section that fits (broken promise → overdue → due today), and only while they still owe
// money. Nobody is called from here: the alert only offers a Remind action per person.
// All dates are India dates on the demo clock; promises are passed in after the promise check.
import { addDays } from '../clock.ts';
import type { BookEntry, BookShopkeeper } from '../db/book-repository.ts';
import { computeDues, type Dues } from './dues.ts';
import type { PromiseRecord } from './promise-check.ts';

/** A broken promise older than this no longer puts someone in the alert's first section. */
export const BROKEN_ALERT_DAYS = 14;

export type DueReason = 'broken_promise' | 'overdue' | 'due_today';

export interface AlertPromise extends PromiseRecord {
  readonly shopkeeperId: string;
}

export interface DuePerson {
  readonly shopkeeper: BookShopkeeper;
  readonly reason: DueReason;
  readonly dues: Dues;
  /** Set for reason 'broken_promise': the promise that was broken. */
  readonly brokenPromise: { readonly amount: number; readonly promiseDate: string } | null;
}

export interface DueAlert {
  readonly brokenPromise: readonly DuePerson[];
  readonly overdue: readonly DuePerson[];
  readonly dueToday: readonly DuePerson[];
  /** Everyone above, in that order: the order of the Remind buttons and of "remind all". */
  readonly people: readonly DuePerson[];
}

export interface DueAlertInput {
  readonly shopkeepers: readonly BookShopkeeper[];
  readonly entries: readonly BookEntry[];
  readonly promises: readonly AlertPromise[];
  readonly today: string;
}

/** Items keyed by shopkeeper id (also used by Munshi's book_summary, M8). */
export function groupBy<T extends { readonly shopkeeperId: string }>(
  items: readonly T[],
): ReadonlyMap<string, readonly T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    groups.set(item.shopkeeperId, [...(groups.get(item.shopkeeperId) ?? []), item]);
  }
  return groups;
}

/** The shopkeeper's newest promise, when it is broken and recent enough to raise. */
function recentBroken(promises: readonly AlertPromise[], today: string): AlertPromise | null {
  const newest = [...promises].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!newest || newest.status !== 'broken') return null;
  const recent = newest.promiseDate >= addDays(today, -BROKEN_ALERT_DAYS);
  return recent && newest.promiseDate <= today ? newest : null;
}

function reasonOf(dues: Dues, broken: AlertPromise | null, today: string): DueReason | null {
  if (dues.outstanding <= 0) return null;
  if (broken) return 'broken_promise';
  if (dues.overdueAmount > 0) return 'overdue';
  return dues.nextDueDate === today ? 'due_today' : null;
}

function personOf(
  shopkeeper: BookShopkeeper,
  groups: {
    entries: ReadonlyMap<string, readonly BookEntry[]>;
    promises: ReadonlyMap<string, readonly AlertPromise[]>;
  },
  today: string,
): DuePerson | null {
  const dues = computeDues(groups.entries.get(shopkeeper.id) ?? [], today);
  const broken = recentBroken(groups.promises.get(shopkeeper.id) ?? [], today);
  const reason = reasonOf(dues, broken, today);
  if (!reason) return null;
  const brokenPromise = broken ? { amount: broken.amount, promiseDate: broken.promiseDate } : null;
  return { shopkeeper, reason, dues, brokenPromise };
}

function byMostOverdue(a: DuePerson, b: DuePerson): number {
  return b.dues.daysOverdue - a.dues.daysOverdue || b.dues.outstanding - a.dues.outstanding;
}

function byNextDue(a: DuePerson, b: DuePerson): number {
  return b.dues.nextDueAmount - a.dues.nextDueAmount;
}

export function buildDueAlert(input: DueAlertInput): DueAlert {
  const groups = { entries: groupBy(input.entries), promises: groupBy(input.promises) };
  const people = input.shopkeepers
    .map((shopkeeper) => personOf(shopkeeper, groups, input.today))
    .filter((person): person is DuePerson => person !== null);
  const inSection = (reason: DueReason): DuePerson[] =>
    people.filter((person) => person.reason === reason);
  const brokenPromise = inSection('broken_promise').sort(byMostOverdue);
  const overdue = inSection('overdue').sort(byMostOverdue);
  const dueToday = inSection('due_today').sort(byNextDue);
  return { brokenPromise, overdue, dueToday, people: [...brokenPromise, ...overdue, ...dueToday] };
}
