// supabase/functions/_shared/ledger/dues.ts
// What a shopkeeper owes, worked out from the credit book. Rules (M3 plan, 100% tested):
// - only confirmed entries count (a claimed payment waits for the owner; rejected never counts)
// - payments clear the oldest credit first (by due date, then by the day it was given)
// - "overdue" and "days overdue" use the date passed in, so the demo clock works
// Money is added in paise (whole numbers) so rupee amounts with paise add up exactly.
import { DAY_MS } from '../clock.ts';
import type { LedgerEntry } from '../schemas/ledger.ts';

const PAISE_PER_RUPEE = 100;

export interface Dues {
  readonly outstanding: number;
  readonly overdueAmount: number;
  /** Due date of the oldest credit not yet paid off (may be in the future). */
  readonly oldestDueDate: string | null;
  readonly daysOverdue: number;
  /** First unpaid credit due today or later. */
  readonly nextDueDate: string | null;
  readonly nextDueAmount: number;
}

export const NO_DUES: Dues = {
  outstanding: 0,
  overdueAmount: 0,
  oldestDueDate: null,
  daysOverdue: 0,
  nextDueDate: null,
  nextDueAmount: 0,
};

interface OpenCredit {
  readonly dueDate: string;
  readonly paise: number;
}

function toPaise(rupees: number): number {
  return Math.round(rupees * PAISE_PER_RUPEE);
}

function toRupees(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** The database requires a due date on every credit; a missing one counts from the day given. */
function dueDateOf(entry: LedgerEntry): string {
  return entry.dueDate ?? entry.entryDate;
}

function byOldestFirst(a: LedgerEntry, b: LedgerEntry): number {
  const byDue = dueDateOf(a).localeCompare(dueDateOf(b));
  return byDue !== 0 ? byDue : a.entryDate.localeCompare(b.entryDate);
}

/** Credits still (partly) unpaid after confirmed payments are applied oldest first. */
function openCredits(entries: readonly LedgerEntry[]): readonly OpenCredit[] {
  const confirmed = entries.filter((entry) => entry.status === 'confirmed');
  let paymentsLeft = confirmed
    .filter((entry) => entry.kind === 'payment')
    .reduce((sum, entry) => sum + toPaise(entry.amount), 0);
  const credits = confirmed.filter((entry) => entry.kind === 'credit').sort(byOldestFirst);
  return credits.flatMap((entry): OpenCredit[] => {
    const owed = toPaise(entry.amount);
    const cleared = Math.min(owed, paymentsLeft);
    paymentsLeft -= cleared;
    return owed > cleared ? [{ dueDate: dueDateOf(entry), paise: owed - cleared }] : [];
  });
}

function sumPaise(credits: readonly OpenCredit[]): number {
  return credits.reduce((sum, credit) => sum + credit.paise, 0);
}

export function computeDues(entries: readonly LedgerEntry[], today: string): Dues {
  const open = openCredits(entries);
  const oldest = open[0];
  if (!oldest) return NO_DUES;
  // ISO dates compare correctly as strings.
  const overdue = open.filter((credit) => credit.dueDate < today);
  const upcoming = open.filter((credit) => credit.dueDate >= today);
  const next = upcoming[0];
  const nextDue = next ? upcoming.filter((credit) => credit.dueDate === next.dueDate) : [];
  return {
    outstanding: toRupees(sumPaise(open)),
    overdueAmount: toRupees(sumPaise(overdue)),
    oldestDueDate: oldest.dueDate,
    daysOverdue: Math.max(0, daysBetween(oldest.dueDate, today)),
    nextDueDate: next?.dueDate ?? null,
    nextDueAmount: toRupees(sumPaise(nextDue)),
  };
}
