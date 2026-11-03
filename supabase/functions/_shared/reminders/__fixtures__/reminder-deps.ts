// supabase/functions/_shared/reminders/__fixtures__/reminder-deps.ts
// ReminderDeps over fakes (FAKE data): Asha's fake repository, the fake reminder repository, call
// statuses from a map, and a recorder for "start N simulated calls" (nothing is sent anywhere).
import {
  createFakeReminderRepository,
  type FakeReminderState,
} from '../../db/fake-reminder-repository.ts';
import { createFakeRepository, FAKE_NOW, type FakeState } from '../../db/fake-repository.ts';
import type { CallStatus } from '../../schemas/shopkeeper.ts';
import type { ReminderDeps } from '../deps.ts';

export interface ReminderSetup {
  readonly deps: ReminderDeps;
  readonly repo: ReturnType<typeof createFakeRepository>;
  readonly store: ReturnType<typeof createFakeReminderRepository>;
  /** Each startSimulations(count) call, in order. */
  readonly started: number[];
}

export interface ReminderSetupOptions {
  readonly repo?: Partial<FakeState>;
  readonly store?: Partial<FakeReminderState>;
  readonly callStatuses?: Readonly<Record<string, readonly CallStatus[]>>;
  readonly now?: Date;
}

export function reminderSetup(options: ReminderSetupOptions = {}): ReminderSetup {
  const now = options.now ?? FAKE_NOW;
  const repo = createFakeRepository({ clock: () => now, ...options.repo });
  const store = createFakeReminderRepository({ clock: () => now, ...options.store });
  const started: number[] = [];
  const deps: ReminderDeps = {
    repo: repo.repo,
    store: store.reminders,
    listCallStatuses: (id) => Promise.resolve(options.callStatuses?.[id] ?? []),
    clock: () => now,
    startSimulations: (count) => {
      started.push(count);
    },
  };
  return { deps, repo, store, started };
}
