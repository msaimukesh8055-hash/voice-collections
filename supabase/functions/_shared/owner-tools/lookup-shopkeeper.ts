// supabase/functions/_shared/owner-tools/lookup-shopkeeper.ts
// lookup_shopkeeper(name) (M8 A5): one shopkeeper in one tool call, two round trips (Decision 4):
// ① the shopkeepers, to resolve the spoken name; ② his entries, promises, last Asha calls and
// call results, in parallel. Then, in code on the demo-clock date: dues (computeDues), the open
// promise and score after the promise check (in memory, nothing written), open payment claims,
// the last 3 live (confirmed) entries, and Asha's calls via buildCallHistory (M7 B1), worded by
// describeHistoryForOwner. An unclear name returns choices and no figures.
import { buildCallHistory, type CallHistory } from '../calls/call-history.ts';
import { describeHistoryForOwner } from '../calls/call-history-owner.ts';
import type { BookEntry, BookShopkeeper } from '../db/book-repository.ts';
import { formatRupees, formatShortDay } from '../format.ts';
import { computeDues, type Dues } from '../ledger/dues.ts';
import { historyStart } from '../ledger/history.ts';
import { applyPromiseChanges, checkPromises, type PromiseRecord } from '../ledger/promise-check.ts';
import { computeScore, type Score } from '../ledger/score.ts';
import { resolveName, unclearNameReply } from './names.ts';
import type { OwnerToolArgs } from './schemas.ts';
import { fitParts, labelOf, MAX_NAMES, paidBy } from './say.ts';
import { ownerOk, type OwnerToolContext, type OwnerToolOutcome } from './types.ts';

/** listPastCalls leaves out the current call; an owner call is never in `calls`, so none is. */
const NO_CURRENT_CALL = '00000000-0000-0000-0000-000000000000';

interface Facts {
  readonly label: string;
  readonly entries: readonly BookEntry[];
  readonly dues: Dues;
  readonly promises: readonly PromiseRecord[];
  readonly score: Score;
  readonly history: CallHistory;
}

function duesParts(facts: Facts): readonly string[] {
  const { dues, label } = facts;
  if (dues.outstanding === 0) return [`${label}: nothing outstanding.`];
  const overdue = dues.overdueAmount > 0 && dues.oldestDueDate !== null
    ? `Overdue ${formatRupees(dues.overdueAmount)} since ${formatShortDay(dues.oldestDueDate)} ` +
      `(${dues.daysOverdue} days).`
    : 'Nothing overdue yet.';
  const next = dues.nextDueDate === null
    ? ''
    : `Next due ${formatRupees(dues.nextDueAmount)} on ${formatShortDay(dues.nextDueDate)}.`;
  return [`${label}: outstanding ${formatRupees(dues.outstanding)}.`, overdue, next];
}

function promisePart(promises: readonly PromiseRecord[]): string {
  const open = promises.find((promise) => promise.status === 'open');
  return open
    ? `Open promise: ${formatRupees(open.amount)} by ${formatShortDay(open.promiseDate)}.`
    : '';
}

function openClaims(entries: readonly BookEntry[]): readonly BookEntry[] {
  return entries.filter((entry) => entry.kind === 'payment' && entry.status === 'claimed');
}

function claimsPart(entries: readonly BookEntry[]): string {
  const lines = openClaims(entries).map((entry) => {
    const day = formatShortDay(entry.entryDate);
    return `${formatRupees(entry.amount)} paid on ${day}${paidBy(entry.paymentMode)}`;
  });
  return lines.length === 0 ? '' : `Payment claims waiting for you: ${lines.join('; ')}.`;
}

/** Newest first: entry date, then when it was written (the same order everywhere in Munshi). */
export function newestFirst(a: BookEntry, b: BookEntry): number {
  return b.entryDate.localeCompare(a.entryDate) || b.createdAt.localeCompare(a.createdAt);
}

/** The last 3 confirmed entries (claimed, rejected and reversed ones are not live). */
export function liveEntries(entries: readonly BookEntry[]): readonly BookEntry[] {
  return entries.filter((entry) => entry.status === 'confirmed').sort(newestFirst).slice(
    0,
    MAX_NAMES,
  );
}

function entriesPart(entries: readonly BookEntry[]): string {
  const lines = liveEntries(entries).map((entry) =>
    `${entry.kind} ${formatRupees(entry.amount)} on ${formatShortDay(entry.entryDate)}`
  );
  return lines.length === 0 ? '' : `Last entries: ${lines.join('; ')}.`;
}

function scorePart(score: Score): string {
  if (score.band === 'new') return 'Score: new customer, not enough history yet.';
  return `Score ${score.score} out of 100 (${score.band}).`;
}

/** Figures first, then what he most likely asked about; the rest only if it fits. */
function describe(facts: Facts): string {
  return fitParts([
    ...duesParts(facts),
    promisePart(facts.promises),
    claimsPart(facts.entries),
    describeHistoryForOwner(facts.history),
    entriesPart(facts.entries),
    scorePart(facts.score),
  ]);
}

async function factsFor(
  shopkeeper: BookShopkeeper,
  ctx: OwnerToolContext,
): Promise<Omit<Facts, 'label'>> {
  const { book, memory, listCallStatuses } = ctx.reads;
  const { today } = ctx;
  const [entries, stored, rows, callStatuses] = await Promise.all([
    book.listShopkeeperEntries(shopkeeper.id),
    memory.listPromises(shopkeeper.id),
    memory.listPastCalls(shopkeeper.id, NO_CURRENT_CALL, historyStart(today)),
    listCallStatuses(shopkeeper.id),
  ]);
  const promises = applyPromiseChanges(stored, checkPromises(stored, entries, today));
  return {
    entries,
    dues: computeDues(entries, today),
    promises,
    score: computeScore({ entries, promises, callStatuses, today }),
    history: buildCallHistory({ rows, promises, entries, today, currentCallId: NO_CURRENT_CALL }),
  };
}

export async function lookupShopkeeper(
  ctx: OwnerToolContext,
  args: OwnerToolArgs<'lookup_shopkeeper'>,
): Promise<OwnerToolOutcome> {
  const shopkeepers = await ctx.reads.book.listShopkeepers(ctx.owner.id);
  const resolution = resolveName(shopkeepers, args.name);
  if (resolution.kind !== 'one') return unclearNameReply(resolution);
  const facts = await factsFor(resolution.shopkeeper, ctx);
  const { dues, score, history } = facts;
  const label = labelOf(resolution.shopkeeper, shopkeepers);
  return ownerOk(describe({ ...facts, label }), {
    shopkeeper: resolution.shopkeeper.name,
    outstanding: dues.outstanding,
    overdue_amount: dues.overdueAmount,
    days_overdue: dues.daysOverdue,
    next_due_date: dues.nextDueDate,
    next_due_amount: dues.nextDueAmount,
    open_claims: openClaims(facts.entries).length,
    score: score.score,
    band: score.band,
    past_calls: history.length,
    their_words_shown: history.filter((call) => call.theirWords !== null).length,
  });
}
