// supabase/functions/_shared/reminders/deps.ts
// What the owner bot needs to remind people (M5 5b), passed in so tests use fakes: Asha's
// repository (the M3 pre-call check in queueCall, the promise checker's writes), the reminder
// repository, call statuses for the score, real time, and a way to start simulated calls in the
// follow-up worker (each one in its own background run).
import type { ReminderRepository } from '../db/reminder-repository.ts';
import type { Repository } from '../db/repository.ts';
import type { CallStatus } from '../schemas/shopkeeper.ts';

export interface ReminderDeps {
  readonly repo: Repository;
  readonly store: ReminderRepository;
  readonly listCallStatuses: (shopkeeperId: string) => Promise<readonly CallStatus[]>;
  /** Real time (rate limits, "called in the last hour"). */
  readonly clock: () => Date;
  /** Wakes the worker `count` times; each wake starts one queued simulated call if a slot is
   * free (at most 4 at once), so asking for too many is harmless. */
  readonly startSimulations: (count: number) => void;
}
