// supabase/functions/_shared/owner-tools/names.test.ts
import { assert, assertEquals } from '@std/assert';
import { LATHA, PRAVEEN_1, PRAVEEN_2, RAMESH } from '../db/fake-book-repository.ts';
import { resolveName, unclearNameReply } from './names.ts';

const ALL = [RAMESH, LATHA, PRAVEEN_1, PRAVEEN_2];

Deno.test('names › one match, any case, several, none', () => {
  assertEquals(resolveName(ALL, 'Latha'), { kind: 'one', shopkeeper: LATHA });
  assertEquals(resolveName(ALL, 'ramesh').kind, 'one');
  assertEquals(resolveName(ALL, 'Praveen'), {
    kind: 'choices',
    shopkeepers: [PRAVEEN_1, PRAVEEN_2],
  });
  assertEquals(resolveName(ALL, 'Venkatesh'), { kind: 'none' });
});

Deno.test('names › choices carry names and shops, never figures', () => {
  const reply = unclearNameReply({ kind: 'choices', shopkeepers: [PRAVEEN_1, PRAVEEN_2] });
  assert(reply.result.ok);
  assertEquals(reply.result.data, {
    choices: 'Praveen (Praveen Bakery); Praveen (Praveen Super Market)',
    choice_count: 2,
  });
  assertEquals(
    reply.result.say,
    'More than one shopkeeper fits that name: Praveen (Praveen Bakery); Praveen (Praveen Super ' +
      'Market). Ask him which one he means. Share no figures until he picks one.',
  );
});

Deno.test('names › none → NOT_FOUND', () => {
  const reply = unclearNameReply({ kind: 'none' });
  assertEquals(reply.result.ok ? null : reply.result.code, 'NOT_FOUND');
});

Deno.test('names › part of the shop name picks one (after "which one?")', () => {
  assertEquals(resolveName(ALL, 'Praveen Bakery'), { kind: 'one', shopkeeper: PRAVEEN_1 });
  assertEquals(resolveName(ALL, 'praveen super'), { kind: 'one', shopkeeper: PRAVEEN_2 });
  assertEquals(resolveName(ALL, 'Praveen, the Super Market one'), {
    kind: 'one',
    shopkeeper: PRAVEEN_2,
  });
  // A small typo in the first name still works; the shop words must be exact.
  assertEquals(resolveName(ALL, 'Praven bakery'), { kind: 'one', shopkeeper: PRAVEEN_1 });
});

Deno.test('names › "&" said as "and" matches', () => {
  const farooq = { ...PRAVEEN_1, id: 'f1', name: 'Farooq', shopName: 'Farooq Kirana & General' };
  const farooq2 = { ...PRAVEEN_2, id: 'f2', name: 'Farooq', shopName: 'Farooq Super Market' };
  const book = [farooq, farooq2];
  assertEquals(resolveName(book, 'Farooq Kirana and General'), { kind: 'one', shopkeeper: farooq });
  assertEquals(resolveName(book, 'Farooq Kirana'), { kind: 'one', shopkeeper: farooq });
  assertEquals(resolveName(book, 'Farooq General'), { kind: 'one', shopkeeper: farooq });
});

Deno.test('names › shop words that fit nobody, or both, never guess', () => {
  // No Praveen has a Kirana: he is asked again which one.
  assertEquals(resolveName(ALL, 'Praveen Kirana').kind, 'choices');
  assertEquals(resolveName(ALL, 'Praveen the one').kind, 'choices');
  assertEquals(resolveName(ALL, 'Venkatesh Bakery'), { kind: 'none' });
  // A word from someone else's shop does not move the name to them.
  assertEquals(resolveName(ALL, 'Latha Bakery'), { kind: 'none' });
});
