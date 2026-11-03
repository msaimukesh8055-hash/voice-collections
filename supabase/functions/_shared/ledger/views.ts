// supabase/functions/_shared/ledger/views.ts
// The owner's read-only ledger replies (SPEC §6.1): "pending" (biggest first, top 10, days
// overdue), "closed" (credits paid off this month) and one shopkeeper (balance, last 5 entries,
// last promise, open claims with [Confirm received] [Not received]). All figures come from
// dues.ts / cleared.ts with the demo-clock "today" passed in.
import type { BookEntry, BookShopkeeper, LastPromise } from '../db/book-repository.ts';
import { formatInr, formatShortDay } from '../format.ts';
import { claimButtonId, lookupRowId } from '../cards/ids.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { type Phrases, phrasesFor } from '../whatsapp/phrases.ts';
import { MAX_BUTTONS, MAX_LIST_ROWS, type Reply, textReply } from '../whatsapp/replies.ts';
import { clearedCredits } from './cleared.ts';
import { computeDues, type Dues } from './dues.ts';

export const VIEW_ROWS = 10;
const LAST_ENTRIES = 5;

export interface BookView {
  readonly shopkeepers: readonly BookShopkeeper[];
  readonly entries: readonly BookEntry[];
  readonly today: string;
  readonly language: Language;
}

function label(shopkeeper: BookShopkeeper): string {
  return shopkeeper.name === shopkeeper.shopName
    ? shopkeeper.name
    : `${shopkeeper.name} (${shopkeeper.shopName})`;
}

function entriesBy(entries: readonly BookEntry[]): ReadonlyMap<string, readonly BookEntry[]> {
  const groups = new Map<string, BookEntry[]>();
  for (const entry of entries) {
    groups.set(entry.shopkeeperId, [...(groups.get(entry.shopkeeperId) ?? []), entry]);
  }
  return groups;
}

function withMore(lines: readonly string[], total: number, phrases: Phrases): string[] {
  const shown = lines.slice(0, VIEW_ROWS);
  return total > VIEW_ROWS ? [...shown, phrases.andMore(total - VIEW_ROWS)] : shown;
}

function pendingLine(shopkeeper: BookShopkeeper, dues: Dues, phrases: Phrases): string {
  const late = dues.overdueAmount > 0 ? phrases.daysOverdue(dues.daysOverdue) : phrases.notDueYet;
  return `${label(shopkeeper)} · ${formatInr(dues.outstanding)} · ${late}`;
}

export function pendingReply(view: BookView): Reply {
  const phrases = phrasesFor(view.language);
  const groups = entriesBy(view.entries);
  const owing = view.shopkeepers
    .map((shopkeeper) => ({
      shopkeeper,
      dues: computeDues(groups.get(shopkeeper.id) ?? [], view.today),
    }))
    .filter((item) => item.dues.outstanding > 0)
    .sort((a, b) => b.dues.outstanding - a.dues.outstanding);
  if (owing.length === 0) return textReply(phrases.nothingPending);
  const total = owing.reduce((sum, item) => sum + item.dues.outstanding, 0);
  const lines = owing.map((item, index) =>
    `${index + 1}. ${pendingLine(item.shopkeeper, item.dues, phrases)}`
  );
  const title = phrases.pendingTitle(owing.length, formatInr(total));
  return textReply([title, ...withMore(lines, owing.length, phrases)].join('\n'));
}

export function closedReply(view: BookView): Reply {
  const phrases = phrasesFor(view.language);
  const groups = entriesBy(view.entries);
  const month = view.today.slice(0, 7);
  const closed = view.shopkeepers
    .flatMap((shopkeeper) =>
      clearedCredits(groups.get(shopkeeper.id) ?? []).map((credit) => ({ shopkeeper, credit }))
    )
    .filter(({ credit }) => credit.clearedOn.startsWith(month) && credit.clearedOn <= view.today)
    .sort((a, b) => b.credit.clearedOn.localeCompare(a.credit.clearedOn));
  if (closed.length === 0) return textReply(phrases.nothingClosed);
  const lines = closed.map(({ shopkeeper, credit }) =>
    `• ${label(shopkeeper)} · ${formatInr(credit.amount)} · ${
      phrases.clearedOn(formatShortDay(credit.clearedOn))
    }`
  );
  return textReply([phrases.closedTitle, ...withMore(lines, closed.length, phrases)].join('\n'));
}

function balanceLine(dues: Dues, phrases: Phrases): string {
  const details = [
    dues.overdueAmount > 0
      ? phrases.overdueSince(formatInr(dues.overdueAmount), dues.daysOverdue)
      : null,
    dues.nextDueDate
      ? phrases.nextDue(formatInr(dues.nextDueAmount), formatShortDay(dues.nextDueDate))
      : null,
  ].filter((part): part is string => part !== null);
  const suffix = details.length > 0 ? ` (${details.join('; ')})` : '';
  return `${phrases.balance}: ${formatInr(dues.outstanding)}${suffix}`;
}

function entryLine(entry: BookEntry, phrases: Phrases): string {
  const kind = entry.kind === 'credit' ? phrases.credit : phrases.payment;
  const due = entry.dueDate ? ` · ${phrases.due} ${formatShortDay(entry.dueDate)}` : '';
  const marks = { confirmed: '', claimed: ` ${phrases.claimed}`, rejected: ` ${phrases.rejected}` };
  return `• ${formatShortDay(entry.entryDate)} · ${kind} ${formatInr(entry.amount)}${due}${
    marks[entry.status]
  }`;
}

function newestFirst(a: BookEntry, b: BookEntry): number {
  return b.entryDate.localeCompare(a.entryDate) || b.createdAt.localeCompare(a.createdAt);
}

function promiseLine(promise: LastPromise | null, phrases: Phrases): string {
  if (!promise) return `${phrases.lastPromise}: ${phrases.noPromise}`;
  const status = phrases.promiseStatus[promise.status];
  return `${phrases.lastPromise}: ${formatInr(promise.amount)} · ${
    formatShortDay(promise.promiseDate)
  } (${status})`;
}

export interface ShopkeeperView {
  readonly shopkeeper: BookShopkeeper;
  readonly entries: readonly BookEntry[];
  readonly lastPromise: LastPromise | null;
  readonly today: string;
  readonly language: Language;
}

function claimCard(view: ShopkeeperView, claim: BookEntry, phrases: Phrases): Reply {
  return {
    kind: 'buttons',
    text: phrases.claimQuestion(
      view.shopkeeper.name,
      formatInr(claim.amount),
      formatShortDay(claim.entryDate),
    ),
    buttons: [
      { id: claimButtonId(claim.id, true, view.language), title: phrases.confirmReceived },
      { id: claimButtonId(claim.id, false, view.language), title: phrases.notReceived },
    ],
  };
}

/** Summary text, then one [Confirm received] [Not received] card per open claim (up to 3). */
export function shopkeeperReplies(view: ShopkeeperView): readonly Reply[] {
  const phrases = phrasesFor(view.language);
  const { shopkeeper } = view;
  const claims = view.entries.filter((entry) => entry.status === 'claimed');
  const recent = [...view.entries].sort(newestFirst).slice(0, LAST_ENTRIES);
  const lines = [
    `*${shopkeeper.name}* · ${shopkeeper.shopName}, ${shopkeeper.area}`,
    balanceLine(computeDues(view.entries, view.today), phrases),
    ...(recent.length > 0
      ? [`${phrases.lastEntries}:`, ...recent.map((e) => entryLine(e, phrases))]
      : []),
    promiseLine(view.lastPromise, phrases),
    ...(claims.length > 0 ? [phrases.openClaims(claims.length)] : []),
  ];
  const cards = claims.slice(0, MAX_BUTTONS).map((claim) => claimCard(view, claim, phrases));
  return [textReply(lines.join('\n')), ...cards];
}

/** "Which Praveen?" for a read-only lookup: each row opens that shopkeeper. */
export function lookupPickReply(
  name: string,
  shopkeepers: readonly BookShopkeeper[],
  language: Language,
): Reply {
  const phrases = phrasesFor(language);
  return {
    kind: 'list',
    text: phrases.pickPrompt(name),
    buttonLabel: phrases.choose,
    rows: shopkeepers.slice(0, MAX_LIST_ROWS).map((shopkeeper) => ({
      id: lookupRowId(shopkeeper.id, language),
      title: shopkeeper.name,
      description: `${shopkeeper.shopName}, ${shopkeeper.area}`,
    })),
  };
}
