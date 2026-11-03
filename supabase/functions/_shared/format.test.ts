// supabase/functions/_shared/format.test.ts
import { assertEquals } from '@std/assert';
import { formatDay, formatInr, formatRupees, formatShortDay } from './format.ts';

Deno.test('format › rupees use Indian digit grouping and the word "rupees"', () => {
  assertEquals(formatRupees(8500), '8,500 rupees');
  assertEquals(formatRupees(125000), '1,25,000 rupees');
  assertEquals(formatRupees(99.5), '99.50 rupees');
});

Deno.test('format › a date is spoken with its weekday', () => {
  assertEquals(formatDay('2026-11-09'), 'Monday, 9 November 2026');
});

Deno.test('format › WhatsApp amounts use the rupee sign and Indian grouping', () => {
  assertEquals(formatInr(13500), '₹13,500');
  assertEquals(formatInr(125000), '₹1,25,000');
  assertEquals(formatInr(99.5), '₹99.50');
});

Deno.test('format › a short day has weekday, day and month', () => {
  assertEquals(formatShortDay('2026-11-15'), 'Sun 15 Nov');
});
