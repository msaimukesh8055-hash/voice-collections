// supabase/functions/_shared/figure-words.test.ts
// Figures in free text (M7 Decision 4, M8 C1): digits in three scripts, commas and decimals, and
// the scale words that hide a figure.
import { assertEquals } from '@std/assert';
import { hasScaleWord, numbersIn } from './figure-words.ts';

Deno.test('numbersIn › ASCII digits with Indian commas and decimals, as plain numbers', () => {
  assertEquals(numbersIn('₹8,500 on Sun 15 Nov, then 1,00,000.50'), ['8500', '15', '100000.5']);
});

Deno.test('numbersIn › Telugu and Devanagari digits become ASCII', () => {
  assertEquals(numbersIn('౫౦౦౦ and ५००'), ['5000', '500']);
});

Deno.test('numbersIn › no digits → none', () => {
  assertEquals(numbersIn('five thousand'), []);
});

Deno.test('hasScaleWord › words that hide a figure, in three languages', () => {
  assertEquals(
    ['5 thousand', 'दो हज़ार', 'ఐదు వేలు', 'all good'].map(hasScaleWord),
    [true, true, true, false],
  );
});
