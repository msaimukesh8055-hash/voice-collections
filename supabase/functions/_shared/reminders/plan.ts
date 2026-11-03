// supabase/functions/_shared/reminders/plan.ts
// Who "Remind all due" calls (SPEC §6.5, M5 Decision 8). From the due alert's people, in its
// order: anyone called in the last hour, paused after a call (pause_reminders) or marked
// do-not-call is skipped and counted, so the confirmation can say "6 to call, 1 called recently".
// At most 10 people a time (the budget guardrail: ~₹1 per simulated call); the rest are counted.
import type { RecentCall } from '../db/reminder-repository.ts';

/** "Called recently" (Decision 8): real time, not the demo clock. */
export const RECENT_CALL_MS = 60 * 60 * 1000;
export const MAX_REMIND_ALL = 10;

export interface PlanInput {
  /** Shopkeeper ids in the alert's order. */
  readonly due: readonly string[];
  readonly recentCalls: readonly RecentCall[];
  readonly paused: readonly string[];
  readonly doNotCall: readonly string[];
  /** Real time. */
  readonly now: Date;
}

export interface RemindPlan {
  readonly toCall: readonly string[];
  readonly skippedRecent: number;
  readonly skippedPaused: number;
  readonly skippedDoNotCall: number;
  /** Eligible, but over MAX_REMIND_ALL. */
  readonly notIncluded: number;
}

export function recentlyCalled(recentCalls: readonly RecentCall[], now: Date): ReadonlySet<string> {
  const since = now.getTime() - RECENT_CALL_MS;
  return new Set(
    recentCalls.filter((call) => Date.parse(call.queuedAt) >= since).map((call) =>
      call.shopkeeperId
    ),
  );
}

export function planRemindAll(input: PlanInput): RemindPlan {
  const recent = recentlyCalled(input.recentCalls, input.now);
  const doNotCall = new Set(input.doNotCall);
  const paused = new Set(input.paused);
  const isDoNotCall = (id: string): boolean => doNotCall.has(id);
  const isRecent = (id: string): boolean => !isDoNotCall(id) && recent.has(id);
  const isPaused = (id: string): boolean => !isDoNotCall(id) && !recent.has(id) && paused.has(id);
  const eligible = input.due.filter((id) =>
    !doNotCall.has(id) && !recent.has(id) && !paused.has(id)
  );
  return {
    toCall: eligible.slice(0, MAX_REMIND_ALL),
    skippedRecent: input.due.filter(isRecent).length,
    skippedPaused: input.due.filter(isPaused).length,
    skippedDoNotCall: input.due.filter(isDoNotCall).length,
    notIncluded: Math.max(0, eligible.length - MAX_REMIND_ALL),
  };
}
