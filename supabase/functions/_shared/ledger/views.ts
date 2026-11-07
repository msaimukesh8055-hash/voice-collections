// supabase/functions/_shared/ledger/views.ts
// The owner's read-only ledger replies (SPEC §6.1): "pending" (biggest first, top 10, days
// overdue, score band), "closed" (credits paid off this month) and one shopkeeper (balance, last 5
// entries, last promise, score, open claims, last call note, with [Confirm received] [Not received]). All figures
// come from dues.ts / cleared.ts with the demo-clock "today" passed in; scores are worked out by
// the caller (score.ts, the same as "why is X N?") and passed in, so this file stays pure.
import type { BookEntry, BookShopkeeper, LastPromise } from '../db/book-repository.ts';
import { formatInr, formatShortDay } from '../format.ts';
import {
  claimButtonId,
  fullPaymentButtonId,
  lookupRowId,
  menuRowId,
  partPaymentButtonId,
  remindButtonId,
} from '../cards/ids.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { summaryPhrasesFor } from '../followup/summary-phrases.ts';
import { type Phrases, phrasesFor } from '../whatsapp/phrases.ts';
import {
  blocks,
  type Button,
  MAX_BUTTONS,
  MAX_LIST_ROWS,
  type Reply,
  textReply,
  withEnglish,
} from '../whatsapp/replies.ts';
import { clearedCredits } from './cleared.ts';
import { computeDues, type Dues } from './dues.ts';
import type { Score } from './score.ts';

export const VIEW_ROWS = 10;
const LAST_ENTRIES = 5;

export interface BookView {
  readonly shopkeepers: readonly BookShopkeeper[];
  readonly entries: readonly BookEntry[];
  readonly today: string;
  readonly language: Language;
}

/** What the views show of a score: the number and its band (SPEC §9). */
export type ScoreTag = Pick<Score, 'score' | 'band'>;

/** "pending" also needs the score of each row it shows (missing → no band on that row). */
export interface PendingView extends BookView {
  readonly scores: ReadonlyMap<string, ScoreTag>;
}

interface Owing {
  readonly shopkeeper: BookShopkeeper;
  readonly entries: readonly BookEntry[];
  readonly dues: Dues;
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

/** "Risky 42"; a new shopkeeper's number means little yet, so just "New". */
function scoreTagText(tag: ScoreTag, language: Language): string {
  const band = summaryPhrasesFor(language).bands[tag.band];
  return tag.band === 'new' ? band : `${band} ${tag.score}`;
}

function pendingLine(item: Owing, view: PendingView, phrases: Phrases): string {
  const { shopkeeper, dues } = item;
  const late = dues.overdueAmount > 0 ? phrases.daysOverdue(dues.daysOverdue) : phrases.notDueYet;
  const tag = view.scores.get(shopkeeper.id);
  const band = tag ? ` · ${scoreTagText(tag, view.language)}` : '';
  return `${label(shopkeeper)} · ${formatInr(dues.outstanding)} · ${late}${band}`;
}

/** Everyone who owes money, biggest first. */
function owingOf(view: BookView): readonly Owing[] {
  const groups = entriesBy(view.entries);
  return view.shopkeepers
    .map((shopkeeper) => {
      const entries = groups.get(shopkeeper.id) ?? [];
      return { shopkeeper, entries, dues: computeDues(entries, view.today) };
    })
    .filter((item) => item.dues.outstanding > 0)
    .sort((a, b) => b.dues.outstanding - a.dues.outstanding);
}

/** The rows "pending" will show (top 10), with their entries, so the caller scores only those. */
export function shownPending(
  view: BookView,
): ReadonlyArray<Pick<Owing, 'shopkeeper' | 'entries'>> {
  return owingOf(view).slice(0, VIEW_ROWS);
}

/** "pending", with the same list rendered in English for the twin (dry-run fix 4). */
export function pendingReply(view: PendingView): Reply {
  return withEnglish(view.language, (language) => pendingIn({ ...view, language }));
}

function pendingIn(view: PendingView): Reply {
  const phrases = phrasesFor(view.language);
  const owing = owingOf(view);
  if (owing.length === 0) return textReply(phrases.nothingPending);
  const total = owing.reduce((sum, item) => sum + item.dues.outstanding, 0);
  const lines = owing.map((item, index) => `${index + 1}. ${pendingLine(item, view, phrases)}`);
  const title = phrases.pendingTitle(owing.length, formatInr(total));
  return textReply(blocks(title, withMore(lines, owing.length, phrases)));
}

/** After "pending" (M7 Decision 9): the same top 10 as a list; a row opens that shopkeeper.
 * Null when nobody owes anything. */
export function pendingOpenList(view: BookView): Reply | null {
  const shown = owingOf(view).slice(0, VIEW_ROWS);
  if (shown.length === 0) return null;
  const phrases = phrasesFor(view.language);
  const rows = shown.map(({ shopkeeper, dues }) => ({
    id: lookupRowId(shopkeeper.id, view.language),
    title: shopkeeper.name,
    description: `${formatInr(dues.outstanding)} · ${
      dues.overdueAmount > 0 ? phrases.daysOverdue(dues.daysOverdue) : phrases.notDueYet
    }`,
  }));
  return withEnglish(view.language, function listIn(each): Reply {
    const text = phrasesFor(each).openShopkeeper;
    return { kind: 'list', text, buttonLabel: phrases.openButton, rows };
  });
}

/** "closed", with the same list rendered in English for the twin (dry-run fix 4). */
export function closedReply(view: BookView): Reply {
  return withEnglish(view.language, (language) => closedIn({ ...view, language }));
}

function closedIn(view: BookView): Reply {
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
  return textReply(blocks(phrases.closedTitle, withMore(lines, closed.length, phrases)));
}

/** M7 Decision 8: the balance, then what is overdue and what falls due next, one per line. */
function balanceLines(dues: Dues, phrases: Phrases): readonly string[] {
  const overdue = dues.overdueAmount > 0
    ? `${phrases.overdueLabel}: ${formatInr(dues.overdueAmount)} · ${
      phrases.dayCount(dues.daysOverdue)
    }`
    : null;
  const next = dues.nextDueDate
    ? `${phrases.nextDueLabel}: ${formatInr(dues.nextDueAmount)} · ${
      formatShortDay(dues.nextDueDate)
    }`
    : null;
  const balance = `${phrases.balance}: ${formatInr(dues.outstanding)}`;
  return [balance, overdue, next].filter((line): line is string => line !== null);
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

function scoreLine(tag: ScoreTag, language: Language): string {
  const phrases = summaryPhrasesFor(language);
  return phrases.score(tag.score, phrases.bands[tag.band]);
}

export interface ShopkeeperView {
  readonly shopkeeper: BookShopkeeper;
  readonly entries: readonly BookEntry[];
  readonly lastPromise: LastPromise | null;
  /** The follow-up agent's note from the last call (SPEC §6.1, §8.4), for the owner to read.
   * Since CP2 (M2) it no longer goes to Asha, so the owner is the only reader. */
  readonly lastNote: string | null;
  /** Null only if it could not be worked out; the line is then left out. */
  readonly score: ScoreTag | null;
  readonly today: string;
  readonly language: Language;
  /** Reply links (cloud build): that customer's page in the books; absent or null = no line. */
  readonly booksLink?: string | null;
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

/** Summary text (with its English rendering), then one [Confirm received] [Not received] card
 * per open claim (up to 3), then "What next for Ramesh?" with its buttons (M7 Decision 9). */
export function shopkeeperReplies(view: ShopkeeperView): readonly Reply[] {
  const phrases = phrasesFor(view.language);
  const claims = view.entries.filter((entry) => entry.status === 'claimed');
  const text = withEnglish(
    view.language,
    (language) => textReply(lookupText({ ...view, language })),
  );
  const cards = claims.slice(0, MAX_BUTTONS).map((claim) => claimCard(view, claim, phrases));
  const outstanding = computeDues(view.entries, view.today).outstanding;
  const next = lookupActionsReply({
    shopkeeper: view.shopkeeper,
    outstanding,
    language: view.language,
  });
  return [text, ...cards, next];
}

function lookupButtons(shopkeeperId: string, owes: boolean, language: Language): readonly Button[] {
  const phrases = phrasesFor(language);
  if (!owes) return [{ id: menuRowId('menu', language), title: phrases.menuButton }];
  return [
    { id: remindButtonId(shopkeeperId, language), title: phrases.remindShort },
    { id: fullPaymentButtonId(shopkeeperId, language), title: phrases.paidInFull },
    { id: partPaymentButtonId(shopkeeperId, language), title: phrases.partPayment },
  ];
}

/** A separate short message after the lookup (so the lookup text and its link never hit the
 * 1,024-character limit of a button message): [Remind] [Paid in full] [Part payment] when he
 * owes something, else just [Menu]. A tap does exactly what the typed command does. */
export function lookupActionsReply(input: {
  shopkeeper: BookShopkeeper;
  outstanding: number;
  language: Language;
}): Reply {
  const { shopkeeper, language } = input;
  const buttons = lookupButtons(shopkeeper.id, input.outstanding > 0, language);
  return withEnglish(language, function nextIn(each): Reply {
    return { kind: 'buttons', text: phrasesFor(each).nextFor(shopkeeper.name), buttons };
  });
}

function lookupText(view: ShopkeeperView): string {
  const phrases = phrasesFor(view.language);
  const { shopkeeper } = view;
  const claims = view.entries.filter((entry) => entry.status === 'claimed');
  const recent = [...view.entries].sort(newestFirst).slice(0, LAST_ENTRIES);
  return blocks(
    [
      `👤 *${shopkeeper.name}* · ${shopkeeper.shopName}, ${shopkeeper.area}`,
      ...balanceLines(computeDues(view.entries, view.today), phrases),
    ],
    recent.length > 0
      ? [`${phrases.lastEntries}:`, ...recent.map((e) => entryLine(e, phrases))]
      : null,
    [
      promiseLine(view.lastPromise, phrases),
      ...(view.score ? [scoreLine(view.score, view.language)] : []),
      ...(claims.length > 0 ? [phrases.openClaims(claims.length)] : []),
    ],
    view.lastNote ? `${phrases.lastNote}: ${view.lastNote}` : null,
    view.booksLink ? phrases.viewInBooks(view.booksLink) : null,
  );
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
