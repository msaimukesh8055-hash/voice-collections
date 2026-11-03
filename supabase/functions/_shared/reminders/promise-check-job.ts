// supabase/functions/_shared/reminders/promise-check-job.ts
// The once-a-day promise check (M5 Decision 3), run by pg_cron through the worker. It runs the
// same checker as the alert and get_dues on the demo-clock date, writes kept/broken (compare-and-
// set, so running twice changes nothing), and recalculates the score (SPEC §9) of every shopkeeper
// whose promise changed. Returns how many promises changed.
import { istDate, resolveNow } from '../clock.ts';
import type { BookRepository } from '../db/book-repository.ts';
import type { FollowupRepository } from '../db/followup-repository.ts';
import type { ReminderRepository } from '../db/reminder-repository.ts';
import type { Repository } from '../db/repository.ts';
import { computeScore } from '../ledger/score.ts';
import type { Logger } from '../log.ts';
import { loadDueAlert } from './load-alert.ts';

export interface PromiseCheckDeps {
  readonly book: BookRepository;
  readonly store: ReminderRepository;
  readonly repo: Repository;
  readonly followups: Pick<FollowupRepository, 'listCallStatuses' | 'saveScore'>;
  readonly clock: () => Date;
  readonly log: Logger;
}

async function rescore(shopkeeperId: string, today: string, deps: PromiseCheckDeps): Promise<void> {
  const [entries, promises, callStatuses] = await Promise.all([
    deps.repo.getLedger(shopkeeperId),
    deps.repo.listPromises(shopkeeperId),
    deps.followups.listCallStatuses(shopkeeperId),
  ]);
  const score = computeScore({ entries, promises, callStatuses, today });
  await deps.followups.saveScore(shopkeeperId, score, deps.clock());
}

export async function runPromiseCheck(deps: PromiseCheckDeps): Promise<number> {
  const [owner, settings] = await Promise.all([deps.book.getOwner(), deps.repo.getDemoSettings()]);
  if (!owner) return 0;
  const today = istDate(resolveNow(settings.demoClock, deps.clock()));
  const shopkeepers = await deps.book.listShopkeepers(owner.id);
  const { changes } = await loadDueAlert(deps, { ownerId: owner.id, shopkeepers, today });
  const changedIds = new Set(changes.map((change) => change.shopkeeperId));
  await Promise.all([...changedIds].map((id) => rescore(id, today, deps)));
  deps.log('info', 'promise_check', { changed: changes.length, rescored: changedIds.size });
  return changes.length;
}
