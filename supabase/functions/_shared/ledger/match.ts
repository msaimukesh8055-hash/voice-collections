// supabase/functions/_shared/ledger/match.ts
// Finding the shopkeeper a name means (M4 Decision 5): by name or shop name, ignoring case and
// small typos. Exact matches win; if there are none, near misses are used. One → card, several →
// pick list (up to 10, closest first), none → "add as a new shopkeeper?".
import type { BookShopkeeper } from '../db/book-repository.ts';
import { MAX_LIST_ROWS } from '../whatsapp/replies.ts';

export type MatchResult =
  | { readonly kind: 'one'; readonly shopkeeper: BookShopkeeper }
  | { readonly kind: 'several'; readonly shopkeepers: readonly BookShopkeeper[] }
  | { readonly kind: 'none' };

/** Typos allowed for a name of this length: none for short names, 1 up to 6 letters, then 2. */
const TYPO_STEPS: ReadonlyArray<readonly [number, number]> = [[3, 0], [6, 1]];
const LONG_NAME_TYPOS = 2;

export function normaliseName(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function allowedTypos(length: number): number {
  return TYPO_STEPS.find(([maxLength]) => length <= maxLength)?.[1] ?? LONG_NAME_TYPOS;
}

interface DistanceRow {
  readonly row: readonly number[];
  /** Last cell of the row: the distance so far. */
  readonly end: number;
}

/** One row of the edit-distance table, walking left to right with the diagonal and left cells. */
function nextRow(previous: DistanceRow, letter: string, b: string, rowIndex: number): DistanceRow {
  let diagonal = rowIndex;
  let left = rowIndex + 1;
  const rest = previous.row.slice(1).map((up, j) => {
    const value = Math.min(up + 1, left + 1, diagonal + (letter === b[j] ? 0 : 1));
    diagonal = up;
    left = value;
    return value;
  });
  return { row: [rowIndex + 1, ...rest], end: left };
}

/** Levenshtein distance (insert, delete, replace = 1 each). */
export function editDistance(a: string, b: string): number {
  const first: DistanceRow = {
    row: Array.from({ length: b.length + 1 }, (_, index) => index),
    end: b.length,
  };
  return [...a].reduce<DistanceRow>((row, letter, index) => nextRow(row, letter, b, index), first)
    .end;
}

function distanceTo(query: string, shopkeeper: BookShopkeeper): number {
  return Math.min(
    editDistance(query, normaliseName(shopkeeper.name)),
    editDistance(query, normaliseName(shopkeeper.shopName)),
  );
}

function resultOf(found: readonly BookShopkeeper[]): MatchResult {
  const [first] = found;
  if (!first) return { kind: 'none' };
  if (found.length === 1) return { kind: 'one', shopkeeper: first };
  return { kind: 'several', shopkeepers: found.slice(0, MAX_LIST_ROWS) };
}

export function matchShopkeepers(
  name: string,
  shopkeepers: readonly BookShopkeeper[],
): MatchResult {
  const query = normaliseName(name);
  if (query === '') return { kind: 'none' };
  const scored = shopkeepers.map((shopkeeper) => ({
    shopkeeper,
    distance: distanceTo(query, shopkeeper),
  }));
  const exact = scored.filter((item) => item.distance === 0);
  if (exact.length > 0) return resultOf(exact.map((item) => item.shopkeeper));
  const limit = allowedTypos(query.length);
  const near = scored
    .filter((item) => item.distance <= limit)
    .sort((a, b) => a.distance - b.distance);
  return resultOf(near.map((item) => item.shopkeeper));
}
