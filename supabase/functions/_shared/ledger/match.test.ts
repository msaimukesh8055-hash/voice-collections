// supabase/functions/_shared/ledger/match.test.ts
import { assertEquals } from '@std/assert';
import { LATHA, PRAVEEN_1, PRAVEEN_2, RAMESH, SURESH } from '../db/fake-book-repository.ts';
import type { BookShopkeeper } from '../db/book-repository.ts';
import { editDistance, matchShopkeepers, soundsLike } from './match.ts';

const ALL = [RAMESH, LATHA, PRAVEEN_1, PRAVEEN_2, SURESH];

function idsOf(name: string, list: readonly BookShopkeeper[] = ALL): string[] | 'none' {
  const result = matchShopkeepers(name, list);
  if (result.kind === 'none') return 'none';
  return result.kind === 'one' ? [result.shopkeeper.id] : result.shopkeepers.map((s) => s.id);
}

Deno.test('match › exact name, any case', () => {
  assertEquals(idsOf('Ramesh'), [RAMESH.id]);
  assertEquals(idsOf('RAMESH'), [RAMESH.id]);
});

Deno.test('match › exact shop name', () => {
  assertEquals(idsOf('praveen bakery'), [PRAVEEN_1.id]);
});

Deno.test('match › a small typo still finds one shopkeeper', () => {
  assertEquals(idsOf('Ramsh'), [RAMESH.id]);
  assertEquals(idsOf('Lata'), [LATHA.id]);
});

Deno.test('match › two shopkeepers with the same name give a pick list', () => {
  assertEquals(matchShopkeepers('Praveen', ALL).kind, 'several');
  assertEquals(idsOf('Praveen'), [PRAVEEN_1.id, PRAVEEN_2.id]);
});

Deno.test('match › an unknown name or a new full name gives none', () => {
  assertEquals(idsOf('Suresh Babu'), 'none');
  assertEquals(idsOf('Venkat'), 'none');
  assertEquals(idsOf('...'), 'none');
});

Deno.test('match › short names need an exact match', () => {
  const ravi = { ...RAMESH, id: 'r', name: 'Ravi', shopName: 'Ravi Stores' };
  assertEquals(idsOf('Rav', [ravi]), 'none');
});

Deno.test('match › the list holds at most 10, closest first', () => {
  const many = Array.from(
    { length: 12 },
    (_, i) => ({ ...RAMESH, id: String(i), shopName: `Shop ${i}` }),
  );
  const result = matchShopkeepers('Ramesh', many);
  assertEquals(result.kind === 'several' ? result.shopkeepers.length : 0, 10);
});

Deno.test('match › edit distance', () => {
  assertEquals([
    editDistance('ramesh', 'ramesh'),
    editDistance('ramsh', 'ramesh'),
    editDistance('', 'ab'),
  ], [0, 1, 2]);
});

Deno.test('match › edit distance on longer and empty words', () => {
  assertEquals([editDistance('kitten', 'sitting'), editDistance('abc', ''), editDistance('', '')], [
    3,
    3,
    0,
  ]);
});

Deno.test('match › a spelling that sounds the same finds the one shopkeeper (dry-run fix 3)', () => {
  const salim: BookShopkeeper = {
    ...SURESH,
    id: 'b0000000-0000-4000-8000-000000000045',
    name: 'Salim',
    shopName: 'Salim Fancy Store',
  };
  const list = [...ALL, salim];
  assertEquals(idsOf('Saleem', list), [salim.id]);
  assertEquals(idsOf('Salim', list), [salim.id]);
  assertEquals(idsOf('Saalim', list), [salim.id]);
  assertEquals(idsOf('Selim', list), [salim.id]);
  assertEquals(idsOf('Kareem', list), 'none');
  assertEquals(soundsLike('farooq'), 'faruq');
});
