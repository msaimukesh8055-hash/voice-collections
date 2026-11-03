// supabase/functions/_shared/reminders/load-alert.ts
// Loads the due alert for the owner (WhatsApp "who is due?" and the daily message): the book and
// the promises in one round of reads, then the promise checker on the demo-clock date (M5
// Decision 3: "before every alert"), its kept/broken changes written back with a compare-and-set,
// so a promise that broke this morning shows in this alert.
import { addDays } from '../clock.ts';
import type { BookRepository, BookShopkeeper } from '../db/book-repository.ts';
import type { ReminderRepository } from '../db/reminder-repository.ts';
import type { Repository } from '../db/repository.ts';
import {
  type AlertPromise,
  BROKEN_ALERT_DAYS,
  buildDueAlert,
  type DueAlert,
} from '../ledger/due-alert.ts';
import { applyPromiseChanges, checkPromises, type PromiseChange } from '../ledger/promise-check.ts';
import type { LedgerEntry } from '../schemas/ledger.ts';

export interface AlertSource {
  readonly book: Pick<BookRepository, 'listEntries'>;
  readonly store: Pick<ReminderRepository, 'listAlertPromises'>;
  readonly repo: Pick<Repository, 'setPromiseStatus'>;
}

export interface AlertScope {
  readonly ownerId: string;
  readonly shopkeepers: readonly BookShopkeeper[];
  /** India date on the demo clock. */
  readonly today: string;
}

/** A promise the check just marked kept or broken, and whose it is. */
export interface ShopkeeperPromiseChange extends PromiseChange {
  readonly shopkeeperId: string;
}

export interface LoadedAlert {
  readonly alert: DueAlert;
  readonly changes: readonly ShopkeeperPromiseChange[];
}

function changesFor(
  promises: readonly AlertPromise[],
  entries: readonly (LedgerEntry & { readonly shopkeeperId: string })[],
  today: string,
): readonly ShopkeeperPromiseChange[] {
  const ids = new Set(promises.filter((p) => p.status === 'open').map((p) => p.shopkeeperId));
  return [...ids].flatMap((id) =>
    checkPromises(
      promises.filter((promise) => promise.shopkeeperId === id),
      entries.filter((entry) => entry.shopkeeperId === id),
      today,
    ).map((change) => ({ ...change, shopkeeperId: id }))
  );
}

export async function loadDueAlert(source: AlertSource, scope: AlertScope): Promise<LoadedAlert> {
  const since = addDays(scope.today, -BROKEN_ALERT_DAYS);
  const [entries, stored] = await Promise.all([
    source.book.listEntries(scope.ownerId),
    source.store.listAlertPromises(scope.ownerId, since),
  ]);
  const changes = changesFor(stored, entries, scope.today);
  await Promise.all(
    changes.map((change) => source.repo.setPromiseStatus(change.id, change.status)),
  );
  const promises = applyPromiseChanges(stored, changes);
  const alert = buildDueAlert({
    shopkeepers: scope.shopkeepers,
    entries,
    promises,
    today: scope.today,
  });
  return { alert, changes };
}
