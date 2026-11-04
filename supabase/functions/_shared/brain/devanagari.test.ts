// supabase/functions/_shared/brain/devanagari.test.ts
import { assertEquals } from '@std/assert';
import { asciiDigits, devanagariWord } from './devanagari.ts';

Deno.test('devanagari › shopkeeper names come out in English letters', () => {
  const names: ReadonlyArray<readonly [string, string]> = [
    ['सलीम', 'salim'],
    ['रमेश', 'ramesh'],
    ['प्रकाश', 'prakash'],
    ['राजू', 'raju'],
    ['फ़ारूक़', 'faruq'],
  ];
  for (const [hindi, latin] of names) assertEquals(devanagariWord(hindi), latin, hindi);
});

Deno.test('devanagari › Devanagari figures become ASCII digits', () => {
  assertEquals(asciiDigits('१,०००'), '1,000');
  assertEquals(asciiDigits('₹ 2500'), '₹ 2500');
});
