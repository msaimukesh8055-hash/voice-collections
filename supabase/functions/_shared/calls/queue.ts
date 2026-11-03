// supabase/functions/_shared/calls/queue.ts
// The reminder queue for "Remind all due" (SPEC §6.5, M5 Decision 8). Every person still goes
// through the M3 pre-call check (do-not-call, switchable calling hours and attempt limits), with
// one round of reads for the whole batch and one insert. The live shopkeeper's call is 'live' (it
// rings the phone page, one at a time); everyone else's is 'simulated' and waits as 'queued' until
// the worker starts it: at most 4 simulated calls run at once (claimed inside the database).
import { DAY_MS, istMidnight, resolveNow } from '../clock.ts';
import { checkPrecall, type PrecallBlockCode } from '../compliance/precall.ts';
import type { CreatedCall, RecentCall, ReminderRepository } from '../db/reminder-repository.ts';
import type { DemoSettings, Repository } from '../db/repository.ts';
import type { Language } from '../schemas/shopkeeper.ts';

/** Sarvam's concurrency limit (SPEC §6.5): simulated calls running at the same time. */
export const MAX_SIMULATED_AT_ONCE = 4;
/** A simulated call still "in progress" after this has lost its run (they take ~1 minute). */
export const SIMULATION_STALE_MS = 5 * 60 * 1000;
const ATTEMPT_WINDOW_DAYS = 7;

export interface QueueTarget {
  readonly shopkeeperId: string;
  readonly language: Language;
  readonly doNotCall: boolean;
}

export interface BlockedCall {
  readonly shopkeeperId: string;
  readonly code: PrecallBlockCode;
}

export interface QueuedBatch {
  readonly live: CreatedCall | null;
  readonly simulated: readonly CreatedCall[];
  readonly blocked: readonly BlockedCall[];
}

export interface QueueDeps {
  readonly repo: Pick<Repository, 'getDemoSettings'>;
  readonly store: Pick<ReminderRepository, 'listCallsSince' | 'createCalls'>;
  readonly clock: () => Date;
}

export function simulationStaleBefore(now: Date): Date {
  return new Date(now.getTime() - SIMULATION_STALE_MS);
}

function countSince(calls: readonly RecentCall[], shopkeeperId: string, since: Date): number {
  return calls.filter((call) =>
    call.shopkeeperId === shopkeeperId && Date.parse(call.queuedAt) >= since.getTime()
  ).length;
}

function blockOf(
  target: QueueTarget,
  context: {
    now: Date;
    todayStart: Date;
    settings: DemoSettings;
    calls: readonly RecentCall[];
    weekStart: Date;
  },
): PrecallBlockCode | null {
  const { now, todayStart, settings, calls, weekStart } = context;
  const decision = checkPrecall({
    now,
    doNotCall: target.doNotCall,
    callingHoursEnabled: settings.callingHoursEnabled,
    callLimitsEnabled: settings.callLimitsEnabled,
    callsToday: countSince(calls, target.shopkeeperId, todayStart),
    callsThisWeek: countSince(calls, target.shopkeeperId, weekStart),
  });
  return decision.allowed ? null : decision.code;
}

export async function queueReminders(
  deps: QueueDeps,
  targets: readonly QueueTarget[],
): Promise<QueuedBatch> {
  const settings = await deps.repo.getDemoSettings();
  const realNow = deps.clock();
  // The demo clock decides calling hours only. Attempt windows use the real clock (CP2 M1),
  // because queued_at is the database's real now().
  const now = resolveNow(settings.demoClock, realNow);
  const todayStart = istMidnight(realNow);
  const weekStart = istMidnight(new Date(realNow.getTime() - (ATTEMPT_WINDOW_DAYS - 1) * DAY_MS));
  const calls = await deps.store.listCallsSince(weekStart);
  const context = { now, todayStart, settings, calls, weekStart };
  const checked = targets.map((target) => ({ target, code: blockOf(target, context) }));
  const allowed = checked.filter((item) => item.code === null).map((item) => item.target);
  const created = await deps.store.createCalls(allowed.map((target) => ({
    shopkeeperId: target.shopkeeperId,
    language: target.language,
    mode: target.shopkeeperId === settings.liveShopkeeperId ? 'live' : 'simulated',
  })));
  const isLive = (call: CreatedCall): boolean => call.shopkeeperId === settings.liveShopkeeperId;
  return {
    live: created.find(isLive) ?? null,
    simulated: created.filter((call) => !isLive(call)),
    blocked: checked.flatMap((item) =>
      item.code === null ? [] : [{ shopkeeperId: item.target.shopkeeperId, code: item.code }]
    ),
  };
}
