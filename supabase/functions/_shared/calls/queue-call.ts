// supabase/functions/_shared/calls/queue-call.ts
// The one way a reminder call is created: the demo "Ring" button (M3) and WhatsApp's Remind
// button (M4) both come through here, so the pre-call rules can't be skipped.
import { DAY_MS, istMidnight, resolveNow } from '../clock.ts';
import { checkPrecall, type PrecallBlockCode } from '../compliance/precall.ts';
import type { CallMode, Repository, Shopkeeper } from '../db/repository.ts';
import { isStillRinging } from './ringing.ts';

const ATTEMPT_WINDOW_DAYS = 7;
/**
 * Rate limit (CP1 M2): the anon key is public, so a script could queue calls in a loop and use up
 * a shopkeeper's daily attempts. Counted on real time and per shopkeeper: generous for a person
 * clicking, useless for a loop.
 */
export const RING_RATE_LIMIT = { maxCalls: 3, windowMs: 60_000 } as const;

export interface QueueCallDeps {
  readonly repo: Repository;
  readonly clock: () => Date;
}

export interface QueueCallInput {
  readonly shopkeeperId: string;
  readonly mode: CallMode;
}

export type QueueCallResult =
  | { readonly ok: true; readonly callId: string; readonly alreadyQueued: boolean }
  | { readonly ok: false; readonly code: PrecallBlockCode | 'NOT_FOUND' | 'RATE_LIMITED' };

interface CallHistory {
  readonly shopkeeper: Shopkeeper | null;
  readonly waitingCallId: string | null;
  readonly callsToday: number;
  readonly callsThisWeek: number;
  readonly recentCalls: number;
}

async function loadHistory(
  deps: QueueCallDeps,
  shopkeeperId: string,
  now: Date,
): Promise<CallHistory> {
  const weekStart = istMidnight(new Date(now.getTime() - (ATTEMPT_WINDOW_DAYS - 1) * DAY_MS));
  const rateWindowStart = new Date(deps.clock().getTime() - RING_RATE_LIMIT.windowMs);
  const [shopkeeper, waiting, callsToday, callsThisWeek, recentCalls] = await Promise.all([
    deps.repo.getShopkeeper(shopkeeperId),
    deps.repo.findRingingCall(shopkeeperId),
    deps.repo.countCallsSince(shopkeeperId, istMidnight(now)),
    deps.repo.countCallsSince(shopkeeperId, weekStart),
    deps.repo.countCallsSince(shopkeeperId, rateWindowStart),
  ]);
  // A stale call (nobody answered) doesn't block a new one; the phone page marks it missed.
  const waitingCallId = waiting && isStillRinging(waiting, deps.clock()) ? waiting.callId : null;
  return { shopkeeper, waitingCallId, callsToday, callsThisWeek, recentCalls };
}

export async function queueCall(
  deps: QueueCallDeps,
  input: QueueCallInput,
): Promise<QueueCallResult> {
  const settings = await deps.repo.getDemoSettings();
  const now = resolveNow(settings.demoClock, deps.clock());
  const history = await loadHistory(deps, input.shopkeeperId, now);
  const { shopkeeper } = history;
  if (!shopkeeper) return { ok: false, code: 'NOT_FOUND' };
  // A second tap while the phone is still ringing must not stack up calls.
  if (history.waitingCallId) {
    return { ok: true, callId: history.waitingCallId, alreadyQueued: true };
  }
  if (history.recentCalls >= RING_RATE_LIMIT.maxCalls) return { ok: false, code: 'RATE_LIMITED' };

  const decision = checkPrecall({ now, doNotCall: shopkeeper.doNotCall, ...settings, ...history });
  if (!decision.allowed) return { ok: false, code: decision.code };

  const callId = await deps.repo.createCall({
    shopkeeperId: shopkeeper.id,
    language: shopkeeper.language,
    mode: input.mode,
  });
  return { ok: true, callId, alreadyQueued: false };
}
