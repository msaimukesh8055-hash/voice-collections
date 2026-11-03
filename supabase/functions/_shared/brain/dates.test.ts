// supabase/functions/_shared/brain/dates.test.ts
import { assertEquals } from '@std/assert';
import { dueDateOrDefault, findDueDate, nextWeekday } from './dates.ts';

/** Monday 2 November 2026. */
const TODAY = '2026-11-02';

function dateOf(text: string, today = TODAY): string | null {
  return findDueDate(text, today)?.date ?? null;
}

Deno.test('dates › "15th" is this month while the 15th is ahead', () => {
  assertEquals(dateOf('ramesh 5000 due 15th'), '2026-11-15');
  assertEquals(dateOf('ramesh 5000 due 2nd'), '2026-11-02');
});

Deno.test('dates › "15th" after the 15th means next month (and next year in December)', () => {
  assertEquals(dateOf('due 15th', '2026-11-20'), '2026-12-15');
  assertEquals(dateOf('due 15th', '2026-12-20'), '2027-01-15');
});

Deno.test('dates › "due 15", "15 tak", "15th lopu" are days of the month', () => {
  assertEquals(dateOf('ramesh 5000 due 15'), '2026-11-15');
  assertEquals(dateOf('ramesh 5000 15 tak'), '2026-11-15');
  assertEquals(dateOf('ramesh 5000 15th lopu'), '2026-11-15');
});

Deno.test('dates › a day past the month end is clamped to the last day', () => {
  assertEquals(dateOf('due 31st', '2026-11-02'), '2026-11-30');
});

Deno.test('dates › day and month in either order; a passed date moves to next year', () => {
  assertEquals(dateOf('due 15 nov'), '2026-11-15');
  assertEquals(dateOf('due 5th december'), '2026-12-05');
  assertEquals(dateOf('due nov 15'), '2026-11-15');
  assertEquals(dateOf('due 1 nov'), '2027-11-01');
});

Deno.test('dates › weekdays in English, Hindi and Telugu are the next one after today', () => {
  assertEquals(dateOf('due next monday'), '2026-11-09');
  assertEquals(dateOf('by friday'), '2026-11-06');
  assertEquals(dateOf('shukravar'), '2026-11-06');
  assertEquals(dateOf('sukravaram'), '2026-11-06');
});

Deno.test('dates › relative days and tomorrow', () => {
  assertEquals(dateOf('in 10 days'), '2026-11-12');
  assertEquals(dateOf('10 din mein'), '2026-11-12');
  assertEquals(dateOf('10 rojullo'), '2026-11-12');
  assertEquals(dateOf('tomorrow'), '2026-11-03');
  assertEquals(dateOf('repu'), '2026-11-03');
});

Deno.test('dates › ISO dates are taken as written', () => {
  assertEquals(dateOf('due 2026-12-01'), '2026-12-01');
});

Deno.test('dates › amounts and plain text are not dates', () => {
  assertEquals(dateOf('ramesh 5000'), null);
  assertEquals(dateOf('ramesh due 5k'), null);
  assertEquals(dateOf('due 45th'), null);
  assertEquals(dateOf('due 45 nov'), null);
});

Deno.test('dates › the span covers the marker word, so it can be cut out', () => {
  const found = findDueDate('ramesh 5000 due 15th', TODAY);
  assertEquals([found?.start, found?.end], [12, 20]);
});

Deno.test('dates › a missing due date defaults to 15 days', () => {
  assertEquals(dueDateOrDefault(null, TODAY), '2026-11-17');
  assertEquals(dueDateOrDefault('2026-11-20', TODAY), '2026-11-20');
});

Deno.test('dates › an unknown weekday name gives no date', () => {
  assertEquals(nextWeekday('funday', TODAY), null);
});
