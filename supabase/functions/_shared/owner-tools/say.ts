// supabase/functions/_shared/owner-tools/say.ts
// How Munshi's read tools write `say` (M8 Decision 4): English facts with figures formatted in
// code (Munshi speaks them in his language), at most 3 names with "and N more" so a count is
// always truthful, and at most MAX_SAY_CHARS so Sarvam's LLM turn stays short.
import type { BookShopkeeper } from '../db/book-repository.ts';
import type { PaymentMode } from '../schemas/ledger.ts';

export const MAX_SAY_CHARS = 600;
export const MAX_NAMES = 3;

/** "Ramesh", or "Praveen (Praveen Bakery)" when another shopkeeper has the same name. */
export function labelOf(shopkeeper: BookShopkeeper, all: readonly BookShopkeeper[]): string {
  const sameName = all.filter((other) => other.name === shopkeeper.name).length > 1;
  return sameName ? `${shopkeeper.name} (${shopkeeper.shopName})` : shopkeeper.name;
}

/** The first MAX_NAMES lines joined with "; ", then ", and N more" for the rest. */
export function topLines(lines: readonly string[]): string {
  const shown = lines.slice(0, MAX_NAMES).join('; ');
  const more = lines.length - MAX_NAMES;
  return more > 0 ? `${shown}, and ${more} more` : shown;
}

/** "1 person" / "3 people". */
export function people(count: number): string {
  return count === 1 ? '1 person' : `${count} people`;
}

/** Parts in priority order: each is kept only while the whole still fits in MAX_SAY_CHARS, so a
 * long part further down never pushes out a shorter, later one. */
export function fitParts(parts: readonly string[]): string {
  return parts.filter((part) => part !== '').reduce((said, part) => {
    const next = said === '' ? part : `${said} ${part}`;
    return next.length <= MAX_SAY_CHARS ? next : said;
  }, '');
}

/** " by bank transfer", or "" when the mode is not known. */
export function paidBy(mode: PaymentMode | null): string {
  return mode === null ? '' : ` by ${mode.replace('_', ' ')}`;
}
