// supabase/functions/_shared/brain/amounts.test.ts
import { assertEquals } from '@std/assert';
import { findAmount, MAX_AMOUNT } from './amounts.ts';

function amountOf(text: string): number | null {
  return findAmount(text)?.amount ?? null;
}

Deno.test('amounts › plain, grouped and rupee-marked amounts', () => {
  assertEquals(amountOf('ramesh 5000'), 5000);
  assertEquals(amountOf('ramesh 5,000'), 5000);
  assertEquals(amountOf('ramesh 1,25,000'), 125000);
  assertEquals(amountOf('ramesh ₹5000'), 5000);
  assertEquals(amountOf('ramesh rs. 5000'), 5000);
  assertEquals(amountOf('ramesh 5000/-'), 5000);
  assertEquals(amountOf('ramesh 99.50'), 99.5);
});

Deno.test('amounts › short forms in English, Hindi and Telugu', () => {
  assertEquals(amountOf('ramesh 5k'), 5000);
  assertEquals(amountOf('ramesh 2.5k'), 2500);
  assertEquals(amountOf('ramesh 5 thousand'), 5000);
  assertEquals(amountOf('ramesh 5 hazaar'), 5000);
  assertEquals(amountOf('ramesh 5 vela'), 5000);
  assertEquals(amountOf('ramesh 2 lakh'), 200000);
});

Deno.test('amounts › reports where the amount sits so it can be cut out', () => {
  assertEquals(findAmount('ramesh ₹5,000 rice'), { amount: 5000, start: 7, end: 13 });
});

Deno.test('amounts › no amount, zero or absurd amounts give null', () => {
  assertEquals(amountOf('ramesh'), null);
  assertEquals(amountOf('ramesh 0'), null);
  assertEquals(amountOf(`ramesh ${MAX_AMOUNT + 1}`), null);
});
