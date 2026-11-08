// supabase/functions/_shared/reminders/promise-lists.ts
// "Promises this week" and "broken lately" (Munshi's book_summary and WhatsApp /promises,
// 2026-11-08): the alert promises judged by the promise checker in memory (nothing written),
// then open ones falling due in the next 7 days (soonest first) and broken ones from the last
// 14 days (newest first). One rule, so the voice line and the WhatsApp reply always agree.
import { addDays } from '../clock.ts';
import { type AlertPromise, BROKEN_ALERT_DAYS } from '../ledger/due-alert.ts';
import { applyPromiseChanges } from '../ledger/promise-check.ts';
import type { LedgerEntry } from '../schemas/ledger.ts';
import { changesFor } from './load-alert.ts';

/** Open promises falling due within this many days count as "this week". */
export const PROMISE_WEEK_DAYS = 7;

export interface PromiseBook {
  readonly promises: readonly AlertPromise[];
  readonly entries: readonly (LedgerEntry & { readonly shopkeeperId: string })[];
  /** India date on the demo clock. */
  readonly today: string;
}

export interface PromiseLists {
  readonly open: readonly AlertPromise[];
  readonly broken: readonly AlertPromise[];
}

export function promiseLists(book: PromiseBook): PromiseLists {
  const checked = applyPromiseChanges(
    book.promises,
    changesFor(book.promises, book.entries, book.today),
  );
  const weekEnd = addDays(book.today, PROMISE_WEEK_DAYS);
  const brokenSince = addDays(book.today, -BROKEN_ALERT_DAYS);
  const open = checked
    .filter((p) => p.status === 'open' && p.promiseDate >= book.today && p.promiseDate <= weekEnd)
    .sort((a, b) => a.promiseDate.localeCompare(b.promiseDate));
  const broken = checked
    .filter((p) => p.status === 'broken' && p.promiseDate >= brokenSince)
    .sort((a, b) => b.promiseDate.localeCompare(a.promiseDate));
  return { open, broken };
}
