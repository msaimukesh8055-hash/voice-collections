// supabase/functions/_shared/ledger/waiting-views.ts
// What is waiting on the owner (WhatsApp /claims and /promises, 2026-11-08):
//   /claims   payments shopkeepers told Asha about (status 'claimed', never counted), newest
//             first: a title with the count and total, then today's [Confirm received]
//             [Not received] card per claim (at most 5, "and N more")
//   /promises open promises falling due this week and promises broken in the last 14 days
//             (the lists come from reminders/promise-lists.ts, judged by the promise checker)
// Pure: the caller loads the book. Text comes with its English rendering for the twin.
import type { BookEntry, BookShopkeeper } from '../db/book-repository.ts';
import { formatInr, formatShortDay } from '../format.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { blocks, type Reply, textIn } from '../whatsapp/replies.ts';
import { type SlashPhrases, slashPhrasesFor } from '../whatsapp/slash-phrases.ts';
import type { AlertPromise } from './due-alert.ts';
import { toPaise, toRupees } from './dues.ts';
import { claimCardReply, VIEW_ROWS } from './views.ts';

/** Claim cards sent for one /claims (each is its own message). */
export const MAX_CLAIM_CARDS = 5;

const SOMEONE = 'Someone';

function labelOf(shopkeeper: BookShopkeeper): string {
  return shopkeeper.name === shopkeeper.shopName
    ? shopkeeper.name
    : `${shopkeeper.name} (${shopkeeper.shopName})`;
}

function labelFor(shopkeeperId: string, shopkeepers: readonly BookShopkeeper[]): string | null {
  const shopkeeper = shopkeepers.find((each) => each.id === shopkeeperId);
  return shopkeeper ? labelOf(shopkeeper) : null;
}

export interface ClaimsInput {
  readonly shopkeepers: readonly BookShopkeeper[];
  readonly entries: readonly BookEntry[];
  readonly language: Language;
}

function newestFirst(a: BookEntry, b: BookEntry): number {
  return b.entryDate.localeCompare(a.entryDate) || b.createdAt.localeCompare(a.createdAt);
}

/** Claims waiting for the owner, each with its card. Only this owner's shopkeepers' claims. */
export function claimsReplies(input: ClaimsInput): readonly Reply[] {
  const { language, shopkeepers } = input;
  const waiting = input.entries
    .filter((entry) => entry.kind === 'payment' && entry.status === 'claimed')
    .map((entry) => ({ entry, label: labelFor(entry.shopkeeperId, shopkeepers) }))
    .filter((item): item is { entry: BookEntry; label: string } => item.label !== null)
    .sort((a, b) => newestFirst(a.entry, b.entry));
  if (waiting.length === 0) return [textIn(language, (each) => slashPhrasesFor(each).noClaims)];
  const total = toRupees(waiting.reduce((sum, item) => sum + toPaise(item.entry.amount), 0));
  const hidden = waiting.length - MAX_CLAIM_CARDS;
  const title = textIn(language, function titleIn(each): string {
    const phrases = slashPhrasesFor(each);
    return blocks(
      phrases.claimsTitle(waiting.length, formatInr(total)),
      phrases.claimsNote,
      hidden > 0 ? phrasesFor(each).andMore(hidden) : null,
    );
  });
  const cards = waiting
    .slice(0, MAX_CLAIM_CARDS)
    .map((item) => claimCardReply(item.label, item.entry, language));
  return [title, ...cards];
}

export interface PromisesInput {
  readonly lists: {
    readonly open: readonly AlertPromise[];
    readonly broken: readonly AlertPromise[];
  };
  readonly shopkeepers: readonly BookShopkeeper[];
  readonly language: Language;
}

/** One section: its title, its promises and how a line reads. */
interface Section {
  readonly title: string;
  readonly promises: readonly AlertPromise[];
  readonly line: SlashPhrases['promisedBy'];
}

function section(
  { title, promises, line }: Section,
  input: PromisesInput & { readonly each: Language },
): readonly string[] {
  if (promises.length === 0) return [title, slashPhrasesFor(input.each).none];
  const lines = promises.slice(0, VIEW_ROWS).map(function promiseLine(promise): string {
    const label = labelFor(promise.shopkeeperId, input.shopkeepers) ?? SOMEONE;
    return line(label, formatInr(promise.amount), formatShortDay(promise.promiseDate));
  });
  const more = promises.length > VIEW_ROWS
    ? [phrasesFor(input.each).andMore(promises.length - VIEW_ROWS)]
    : [];
  return [title, ...lines, ...more];
}

/** Promises this week, then broken ones; one short line when there are none of either. */
export function promisesReply(input: PromisesInput): Reply {
  const { open, broken } = input.lists;
  return textIn(input.language, function promisesIn(each): string {
    const phrases = slashPhrasesFor(each);
    if (open.length === 0 && broken.length === 0) return phrases.noPromises;
    const scope = { ...input, each };
    return blocks(
      phrases.promisesTitle,
      section(
        { title: phrases.weekSection(open.length), promises: open, line: phrases.promisedBy },
        scope,
      ),
      section(
        { title: phrases.brokenSection(broken.length), promises: broken, line: phrases.brokenOn },
        scope,
      ),
    );
  });
}
