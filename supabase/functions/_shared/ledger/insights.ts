// supabase/functions/_shared/ledger/insights.ts
// "insights" figures (SPEC §6.6, M6 Decision 7), all in code on the demo-clock date, with the
// same rule as dues.ts (confirmed entries only, payments clear the oldest credit first):
// - pie: credit due this month split into collected / not yet due / overdue
// - % collected: collected ÷ all credit due this month
// - total outstanding: every unpaid balance, any month
// - change vs last week: % collected of this month's credit, today vs the book as it was 7 days
//   ago (entries dated after that day left out), in percentage points
// - top 5 defaulters: biggest overdue amount first; ties → more days overdue, then name
// Money is added in paise so the slices add up exactly. 100% tested (money).
import { addDays } from '../clock.ts';
import type { BookEntry, BookShopkeeper } from '../db/book-repository.ts';
import { computeDues, creditStates, toPaise, toRupees } from './dues.ts';

export const TOP_DEFAULTERS = 5;
const WEEK_DAYS = 7;

export interface MonthSplit {
  /** "2026-11": the month of the demo-clock date. */
  readonly month: string;
  readonly collected: number;
  readonly notYetDue: number;
  readonly overdue: number;
  /** collected + notYetDue + overdue. */
  readonly total: number;
}

export interface Defaulter {
  readonly shopkeeper: BookShopkeeper;
  readonly overdueAmount: number;
  readonly daysOverdue: number;
}

export interface Insights {
  readonly today: string;
  readonly split: MonthSplit;
  /** Whole percent, or null when no credit falls due this month. */
  readonly percentCollected: number | null;
  /** Percentage points since 7 days ago, or null when either side has no figure. */
  readonly weekChange: number | null;
  readonly outstanding: number;
  readonly top: readonly Defaulter[];
}

/** The book as it stood on `date`: entries dated after it did not exist yet. */
function asOf(entries: readonly BookEntry[], date: string): readonly BookEntry[] {
  return entries.filter((entry) => entry.entryDate <= date);
}

function groupBy(entries: readonly BookEntry[]): ReadonlyMap<string, readonly BookEntry[]> {
  const groups = new Map<string, BookEntry[]>();
  for (const entry of entries) {
    groups.set(entry.shopkeeperId, [...(groups.get(entry.shopkeeperId) ?? []), entry]);
  }
  return groups;
}

/** This month's credit for every shopkeeper, as the book stood on `date`. */
export function monthSplit(entries: readonly BookEntry[], date: string, month: string): MonthSplit {
  let collected = 0;
  let notYetDue = 0;
  let overdue = 0;
  for (const own of groupBy(asOf(entries, date)).values()) {
    for (const credit of creditStates(own)) {
      if (!credit.dueDate.startsWith(month)) continue;
      collected += credit.owedPaise - credit.leftPaise;
      if (credit.dueDate < date) overdue += credit.leftPaise;
      else notYetDue += credit.leftPaise;
    }
  }
  return {
    month,
    collected: toRupees(collected),
    notYetDue: toRupees(notYetDue),
    overdue: toRupees(overdue),
    total: toRupees(collected + notYetDue + overdue),
  };
}

export function percentOf(split: MonthSplit): number | null {
  if (split.total === 0) return null;
  return Math.round((split.collected / split.total) * 100);
}

function byWorstFirst(a: Defaulter, b: Defaulter): number {
  return b.overdueAmount - a.overdueAmount || b.daysOverdue - a.daysOverdue ||
    a.shopkeeper.name.localeCompare(b.shopkeeper.name);
}

export function computeInsights(
  shopkeepers: readonly BookShopkeeper[],
  entries: readonly BookEntry[],
  today: string,
): Insights {
  const month = today.slice(0, 7);
  const split = monthSplit(entries, today, month);
  const percentCollected = percentOf(split);
  const lastWeek = percentOf(monthSplit(entries, addDays(today, -WEEK_DAYS), month));
  const groups = groupBy(asOf(entries, today));
  const owing = shopkeepers.map((shopkeeper) => ({
    shopkeeper,
    dues: computeDues(groups.get(shopkeeper.id) ?? [], today),
  }));
  const top = owing
    .filter((item) => item.dues.overdueAmount > 0)
    .map((item) => ({
      shopkeeper: item.shopkeeper,
      overdueAmount: item.dues.overdueAmount,
      daysOverdue: item.dues.daysOverdue,
    }))
    .sort(byWorstFirst)
    .slice(0, TOP_DEFAULTERS);
  return {
    today,
    split,
    percentCollected,
    weekChange: percentCollected === null || lastWeek === null ? null : percentCollected - lastWeek,
    outstanding: toRupees(owing.reduce((sum, item) => sum + toPaise(item.dues.outstanding), 0)),
    top,
  };
}
