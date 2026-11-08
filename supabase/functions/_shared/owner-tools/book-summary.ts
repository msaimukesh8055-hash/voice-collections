// supabase/functions/_shared/owner-tools/book-summary.ts
// book_summary(focus) (M8 A5, money figures 100% tested): whole-book answers in one tool call,
// built in code on the demo-clock date with the same money rules as WhatsApp (computeDues: only
// confirmed entries count, oldest credit paid first; computeInsights). One round of reads: the
// whole book (parallel pages), the shopkeepers and the alert promises. Promises are judged in
// memory (the checker), never written here: a read tool does one round trip (Decision 4).
import { addDays } from '../clock.ts';
import type { BookEntry, BookShopkeeper } from '../db/book-repository.ts';
import { formatRupees, formatShortDay } from '../format.ts';
import { type AlertPromise, BROKEN_ALERT_DAYS, groupBy } from '../ledger/due-alert.ts';
import { computeDues, type Dues, toPaise, toRupees } from '../ledger/dues.ts';
import { computeInsights } from '../ledger/insights.ts';
import { applyPromiseChanges } from '../ledger/promise-check.ts';
import { changesFor } from '../reminders/load-alert.ts';
import type { BookFocus, OwnerToolArgs } from './schemas.ts';
import { fitParts, labelOf, paidBy, people, topLines } from './say.ts';
import type { ToolData } from '../tools/types.ts';
import { ownerOk, type OwnerToolContext, type OwnerToolOutcome } from './types.ts';

/** Open promises falling due within this many days count as "this week". */
export const PROMISE_WINDOW_DAYS = 7;

interface Book {
  readonly shopkeepers: readonly BookShopkeeper[];
  readonly entries: readonly BookEntry[];
  readonly promises: readonly AlertPromise[];
  readonly today: string;
}

/** What one focus says, plus its figures for the audit row. */
interface Summary {
  readonly say: string;
  readonly data: ToolData;
}

function summary(say: string, data: ToolData): Summary {
  return { say, data };
}

interface Owing {
  readonly shopkeeper: BookShopkeeper;
  readonly dues: Dues;
}

function sum(amounts: readonly number[]): number {
  return toRupees(amounts.reduce((total, amount) => total + toPaise(amount), 0));
}

/** Everyone who still owes money, with their dues on the demo-clock date. */
function owingOf(book: Book): readonly Owing[] {
  const entries = groupBy(book.entries);
  return book.shopkeepers
    .map((shopkeeper) => ({
      shopkeeper,
      dues: computeDues(entries.get(shopkeeper.id) ?? [], book.today),
    }))
    .filter((item) => item.dues.outstanding > 0);
}

function label(item: { readonly shopkeeper: BookShopkeeper }, book: Book): string {
  return labelOf(item.shopkeeper, book.shopkeepers);
}

function isDueToday(item: Owing, today: string): boolean {
  return item.dues.nextDueDate === today;
}

function byOverdue(a: Owing, b: Owing): number {
  return b.dues.overdueAmount - a.dues.overdueAmount || b.dues.daysOverdue - a.dues.daysOverdue;
}

function byDueToday(a: Owing, b: Owing): number {
  return b.dues.nextDueAmount - a.dues.nextDueAmount;
}

function dueTodayLines(owing: readonly Owing[], book: Book): string[] {
  return owing.filter((item) => isDueToday(item, book.today)).sort(byDueToday).map((item) =>
    `${label(item, book)} ${formatRupees(item.dues.nextDueAmount)}`
  );
}

function overdueTotals(
  owing: readonly Owing[],
): { readonly amount: number; readonly count: number } {
  const overdue = owing.filter((item) => item.dues.overdueAmount > 0);
  return { amount: sum(overdue.map((item) => item.dues.overdueAmount)), count: overdue.length };
}

function overview(book: Book): Summary {
  const owing = owingOf(book);
  if (owing.length === 0) return summary('Nothing is pending in the book.', { outstanding: 0 });
  const outstanding = sum(owing.map((item) => item.dues.outstanding));
  const overdue = overdueTotals(owing);
  const dueToday = dueTodayLines(owing, book);
  const dueLine = dueToday.length === 0
    ? 'Nobody is due today.'
    : `Due today: ${people(dueToday.length)}: ${topLines(dueToday)}.`;
  return summary(
    fitParts([
      `Total pending: ${formatRupees(outstanding)} from ${people(owing.length)}.`,
      `Overdue: ${formatRupees(overdue.amount)} from ${people(overdue.count)}.`,
      dueLine,
    ]),
    {
      outstanding,
      people_owing: owing.length,
      overdue_amount: overdue.amount,
      overdue_people: overdue.count,
      due_today_people: dueToday.length,
    },
  );
}

function dueToday(book: Book): Summary {
  const owing = owingOf(book);
  const due = owing.filter((item) => isDueToday(item, book.today));
  const overdue = overdueTotals(owing);
  const amount = sum(due.map((item) => item.dues.nextDueAmount));
  const dueLine = due.length === 0
    ? 'Nobody is due today.'
    : `Due today: ${people(due.length)}, ${formatRupees(amount)} in all: ` +
      `${topLines(dueTodayLines(owing, book))}.`;
  const overdueLine = overdue.count === 0
    ? 'Nobody is overdue.'
    : `Also overdue: ${people(overdue.count)}, ${formatRupees(overdue.amount)}.`;
  return summary(fitParts([dueLine, overdueLine]), {
    due_today_people: due.length,
    due_today_amount: amount,
    overdue_people: overdue.count,
    overdue_amount: overdue.amount,
  });
}

function overdue(book: Book): Summary {
  const late = owingOf(book).filter((item) => item.dues.overdueAmount > 0).sort(byOverdue);
  if (late.length === 0) return summary('Nobody is overdue.', { overdue_people: 0 });
  const amount = sum(late.map((item) => item.dues.overdueAmount));
  const lines = late.map((item) =>
    `${label(item, book)} ${formatRupees(item.dues.overdueAmount)}, ` +
    `${item.dues.daysOverdue} days late`
  );
  return summary(
    fitParts([
      `Overdue: ${formatRupees(amount)} from ${people(late.length)}.`,
      `Most overdue: ${topLines(lines)}.`,
    ]),
    { overdue_people: late.length, overdue_amount: amount },
  );
}

function shopkeeperLabel(shopkeeperId: string, book: Book): string {
  const shopkeeper = book.shopkeepers.find((each) => each.id === shopkeeperId);
  return shopkeeper ? labelOf(shopkeeper, book.shopkeepers) : 'Someone';
}

/** The alert promises after the promise check, in memory (nothing written). */
function checkedPromises(book: Book): readonly AlertPromise[] {
  return applyPromiseChanges(book.promises, changesFor(book.promises, book.entries, book.today));
}

function promises(book: Book): Summary {
  const checked = checkedPromises(book);
  const weekEnd = addDays(book.today, PROMISE_WINDOW_DAYS);
  const brokenSince = addDays(book.today, -BROKEN_ALERT_DAYS);
  const open = checked
    .filter((p) => p.status === 'open' && p.promiseDate >= book.today && p.promiseDate <= weekEnd)
    .sort((a, b) => a.promiseDate.localeCompare(b.promiseDate));
  const broken = checked
    .filter((p) => p.status === 'broken' && p.promiseDate >= brokenSince)
    .sort((a, b) => b.promiseDate.localeCompare(a.promiseDate));
  const line = (p: AlertPromise, word: string): string =>
    `${shopkeeperLabel(p.shopkeeperId, book)} ${formatRupees(p.amount)} ${word} ` +
    formatShortDay(p.promiseDate);
  const openLine = open.length === 0
    ? 'No promises fall due in the next 7 days.'
    : `Promised for the next 7 days: ${topLines(open.map((p) => line(p, 'by')))}.`;
  const brokenLine = broken.length === 0
    ? 'No promise was broken in the last 14 days.'
    : `Broken in the last 14 days: ${topLines(broken.map((p) => line(p, 'was due')))}.`;
  return summary(fitParts([openLine, brokenLine]), {
    open_promises: open.length,
    broken_promises: broken.length,
  });
}

function claims(book: Book): Summary {
  const waiting = book.entries
    .filter((entry) => entry.kind === 'payment' && entry.status === 'claimed')
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  if (waiting.length === 0) return summary('No payment claims are waiting.', { open_claims: 0 });
  const amount = sum(waiting.map((entry) => entry.amount));
  const lines = waiting.map((entry) => {
    return `${shopkeeperLabel(entry.shopkeeperId, book)} says ${formatRupees(entry.amount)} ` +
      `paid on ${formatShortDay(entry.entryDate)}${paidBy(entry.paymentMode)}`;
  });
  return summary(
    fitParts([
      `Payment claims waiting for you: ${waiting.length}, ${formatRupees(amount)} in all: ` +
      `${topLines(lines)}.`,
      'They count only after he confirms them.',
    ]),
    { open_claims: waiting.length, claimed_amount: amount },
  );
}

/** Exported for tests. */
export function weekLine(change: number | null): string {
  if (change === null) return '';
  if (change === 0) return 'Same as last week.';
  const direction = change > 0 ? 'Up' : 'Down';
  return `${direction} ${Math.abs(change)} points since last week.`;
}

function insights(book: Book): Summary {
  const figures = computeInsights(book.shopkeepers, book.entries, book.today);
  const { split, percentCollected, weekChange, outstanding, top } = figures;
  const monthLine = percentCollected === null
    ? 'No credit falls due this month.'
    : `This month: ${percentCollected}% collected of ${formatRupees(split.total)} due ` +
      `(collected ${formatRupees(split.collected)}, overdue ${formatRupees(split.overdue)}, ` +
      `not yet due ${formatRupees(split.notYetDue)}).`;
  const topLine = top.length === 0
    ? ''
    : `Top defaulters: ${
      topLines(top.map((item) => `${label(item, book)} ${formatRupees(item.overdueAmount)}`))
    }.`;
  return summary(
    fitParts([
      monthLine,
      weekLine(weekChange),
      `Total pending: ${formatRupees(outstanding)}.`,
      topLine,
    ]),
    {
      percent_collected: percentCollected,
      week_change: weekChange,
      outstanding,
      month_total: split.total,
    },
  );
}

const FOCUS: Readonly<Record<BookFocus, (book: Book) => Summary>> = {
  overview,
  due: dueToday,
  overdue,
  promises,
  claims,
  insights,
};

export async function bookSummary(
  ctx: OwnerToolContext,
  args: OwnerToolArgs<'book_summary'>,
): Promise<OwnerToolOutcome> {
  const { book, alerts } = ctx.reads;
  const ownerId = ctx.owner.id;
  const [shopkeepers, entries, stored] = await Promise.all([
    book.listShopkeepers(ownerId),
    book.listEntries(ownerId),
    alerts.listAlertPromises(ownerId, addDays(ctx.today, -BROKEN_ALERT_DAYS)),
  ]);
  const { say, data } = FOCUS[args.focus]({
    shopkeepers,
    entries,
    promises: stored,
    today: ctx.today,
  });
  return ownerOk(say, { focus: args.focus, ...data });
}
