// supabase/functions/_shared/owner-tools/say.test.ts
import { assertEquals } from '@std/assert';
import { PRAVEEN_1, PRAVEEN_2, RAMESH } from '../db/fake-book-repository.ts';
import { fitParts, labelOf, MAX_SAY_CHARS, paidBy, people, topLines } from './say.ts';

Deno.test('say › labelOf adds the shop name only when the name is shared', () => {
  const all = [RAMESH, PRAVEEN_1, PRAVEEN_2];
  assertEquals(labelOf(RAMESH, all), 'Ramesh');
  assertEquals(labelOf(PRAVEEN_1, all), 'Praveen (Praveen Bakery)');
});

Deno.test('say › topLines shows 3 and counts the rest truthfully', () => {
  assertEquals(topLines([]), '');
  assertEquals(topLines(['a', 'b', 'c']), 'a; b; c');
  assertEquals(topLines(['a', 'b', 'c', 'd', 'e']), 'a; b; c, and 2 more');
});

Deno.test('say › people', () => {
  assertEquals([people(0), people(1), people(4)], ['0 people', '1 person', '4 people']);
});

Deno.test('say › fitParts keeps parts in order while they fit, skipping blanks and long ones', () => {
  const long = 'x'.repeat(MAX_SAY_CHARS);
  assertEquals(fitParts(['One.', '', 'Two.']), 'One. Two.');
  assertEquals(fitParts(['One.', long, 'Three.']), 'One. Three.');
  assertEquals(fitParts([long + 'y']), '');
  assertEquals(fitParts([long]).length, MAX_SAY_CHARS);
});

Deno.test('say › paidBy words the payment mode', () => {
  assertEquals([paidBy(null), paidBy('upi'), paidBy('bank_transfer')], [
    '',
    ' by upi',
    ' by bank transfer',
  ]);
});
