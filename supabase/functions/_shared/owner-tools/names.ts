// supabase/functions/_shared/owner-tools/names.ts
// Which shopkeeper a spoken name means (M8 A5), with the same matcher as WhatsApp
// (ledger/match.ts: case, typos, sounds-alike spellings). One match → that shopkeeper; several →
// up to 3 choices with their shop names and no figures, so Munshi asks and never guesses; none →
// NOT_FOUND (a new shopkeeper by voice is out of scope: add new people on WhatsApp).
// Shop words (M8 Build A test finding): after "which Mohan?" the owner says part of the shop name
// ("Mohan Kirana", "the Kirana one"), which the WhatsApp matcher misses because it needs the whole
// shop name. So when that matcher is unsure, the first word picks the people and every other word
// he said must be a word of their shop name ("&" said as "and"; filler like "the", "one" ignored).
import type { BookShopkeeper } from '../db/book-repository.ts';
import { matchShopkeepers, normaliseName } from '../ledger/match.ts';
import { MAX_NAMES, topLines } from './say.ts';
import { ownerFail, ownerOk, type OwnerToolOutcome } from './types.ts';

export type NameResolution =
  | { readonly kind: 'one'; readonly shopkeeper: BookShopkeeper }
  | { readonly kind: 'choices'; readonly shopkeepers: readonly BookShopkeeper[] }
  | { readonly kind: 'none' };

/** Words said around a shop name that are not part of it. */
const FILLER_WORDS: ReadonlySet<string> = new Set([
  'the',
  'one',
  'a',
  'of',
  'shop',
  'wala',
  'wale',
  'vala',
  'garu',
  'anna',
  'bhai',
  'ji',
]);

function words(text: string): readonly string[] {
  return normaliseName(text.replaceAll('&', ' and ')).split(' ').filter(
    function said(word): boolean {
      return word.length > 0 && !FILLER_WORDS.has(word);
    },
  );
}

interface ShopWordFit {
  /** Everyone the first word he said names. */
  readonly named: readonly BookShopkeeper[];
  /** Those of them whose shop has every other word he said. */
  readonly fits: readonly BookShopkeeper[];
}

function byShopWords(shopkeepers: readonly BookShopkeeper[], name: string): ShopWordFit {
  const [first, ...rest] = words(name);
  if (first === undefined) return { named: [], fits: [] };
  const match = matchShopkeepers(first, shopkeepers);
  const named = match.kind === 'one'
    ? [match.shopkeeper]
    : match.kind === 'several'
    ? match.shopkeepers
    : [];
  const fits = named.filter(function shopHasWords(person): boolean {
    const shopWords = new Set(words(`${person.name} ${person.shopName}`));
    return rest.every(function inShop(word): boolean {
      return shopWords.has(word);
    });
  });
  return { named, fits };
}

/** One person, or choices (never a guess): who fits the shop words, else everyone so named. */
function fromShopWords({ named, fits }: ShopWordFit): NameResolution {
  const [only] = fits;
  if (fits.length === 1 && only !== undefined) return { kind: 'one', shopkeeper: only };
  if (fits.length > 1) return { kind: 'choices', shopkeepers: fits };
  return named.length > 1 ? { kind: 'choices', shopkeepers: named } : { kind: 'none' };
}

export function resolveName(shopkeepers: readonly BookShopkeeper[], name: string): NameResolution {
  const match = matchShopkeepers(name, shopkeepers);
  if (match.kind === 'one') return match;
  const shopWords = fromShopWords(byShopWords(shopkeepers, name));
  if (shopWords.kind !== 'none' || match.kind === 'none') return shopWords;
  return { kind: 'choices', shopkeepers: match.shopkeepers };
}

function choiceLabel(shopkeeper: BookShopkeeper): string {
  return `${shopkeeper.name} (${shopkeeper.shopName})`;
}

/** The reply when the name was not one person: choices (no figures) or NOT_FOUND. */
export function unclearNameReply(
  resolution: Exclude<NameResolution, { kind: 'one' }>,
): OwnerToolOutcome {
  if (resolution.kind === 'none') return ownerFail('NOT_FOUND');
  const labels = resolution.shopkeepers.map(choiceLabel);
  const shown = labels.slice(0, MAX_NAMES);
  const ask = labels.length > MAX_NAMES
    ? 'Ask him for the shop name too.'
    : 'Ask him which one he means.';
  return ownerOk(
    `More than one shopkeeper fits that name: ${topLines(labels)}. ${ask} ` +
      'Share no figures until he picks one.',
    { choices: shown.join('; '), choice_count: labels.length },
  );
}
