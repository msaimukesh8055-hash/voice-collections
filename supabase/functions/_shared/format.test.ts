// supabase/functions/_shared/format.test.ts
import { assertEquals } from '@std/assert';
import { formatDay, formatRupees } from './format.ts';

Deno.test('format › rupees use Indian digit grouping and the word "rupees"', () => {
  assertEquals(formatRupees(8500), '8,500 rupees');
  assertEquals(formatRupees(125000), '1,25,000 rupees');
  assertEquals(formatRupees(99.5), '99.50 rupees');
});

Deno.test('format › a date is spoken with its weekday', () => {
  assertEquals(formatDay('2026-11-09'), 'Monday, 9 November 2026');
});
