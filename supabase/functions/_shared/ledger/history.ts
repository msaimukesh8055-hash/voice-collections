// supabase/functions/_shared/ledger/history.ts
// "The last 6 months" used by the tone ladder (broken promises) and the reliability score
// (paid on time, promises kept): one constant, so both look at the same history.
import { addDays } from '../clock.ts';

export const HISTORY_DAYS = 182;

/** True when an India date falls inside the last 6 months up to `today` (inclusive). */
export function isWithinHistory(date: string, today: string): boolean {
  return date > addDays(today, -HISTORY_DAYS) && date <= today;
}

/** Start of the six-month window (India midnight), for reading past calls (get_dues, and
 * Munshi's lookup since M8). */
export function historyStart(today: string): Date {
  return new Date(`${addDays(today, -HISTORY_DAYS)}T00:00:00+05:30`);
}
