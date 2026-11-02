// supabase/functions/_shared/clock.test.ts
import { assertEquals } from '@std/assert';
import { addDays, istDate, istDayLabel, istHour, istMidnight, resolveNow } from './clock.ts';

const REAL_NOW = new Date('2026-11-01T06:30:00Z'); // 12:00 IST

Deno.test('resolveNow › uses the real time when no demo clock is set', () => {
  assertEquals(resolveNow(null, REAL_NOW), REAL_NOW);
});

Deno.test('resolveNow › uses the demo clock when set', () => {
  assertEquals(
    resolveNow('2026-11-01T15:30:00Z', REAL_NOW).toISOString(),
    '2026-11-01T15:30:00.000Z',
  );
});

Deno.test('istHour › converts UTC to India time (UTC+5:30)', () => {
  assertEquals(istHour(new Date('2026-11-01T02:29:00Z')), 7); // 07:59 IST
  assertEquals(istHour(new Date('2026-11-01T02:30:00Z')), 8); // 08:00 IST
  assertEquals(istHour(new Date('2026-11-01T13:30:00Z')), 19); // 19:00 IST
});

Deno.test('istDate › rolls over at India midnight, not UTC midnight', () => {
  assertEquals(istDate(new Date('2026-10-31T18:29:00Z')), '2026-10-31'); // 23:59 IST
  assertEquals(istDate(new Date('2026-10-31T18:30:00Z')), '2026-11-01'); // 00:00 IST
});

Deno.test('istMidnight › returns the start of the India day as a UTC instant', () => {
  assertEquals(istMidnight(REAL_NOW).toISOString(), '2026-10-31T18:30:00.000Z');
});

Deno.test('addDays › adds calendar days across month ends', () => {
  assertEquals(addDays('2026-10-28', 10), '2026-11-07');
  assertEquals(addDays('2026-11-01', -6), '2026-10-26');
});

Deno.test('istDayLabel › names the India weekday with the date', () => {
  assertEquals(istDayLabel(REAL_NOW), 'Sunday, 2026-11-01');
  assertEquals(istDayLabel(new Date('2026-11-06T20:00:00Z')), 'Saturday, 2026-11-07');
});
