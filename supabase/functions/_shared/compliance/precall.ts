// supabase/functions/_shared/compliance/precall.ts
// Pre-call compliance check (RBI Fair Practices Code, SPEC §9). Runs before a call token is issued.
import { istHour } from '../clock.ts';

export const CALLING_HOURS_START = 8; // 08:00 IST, inclusive
export const CALLING_HOURS_END = 19; // 19:00 IST, exclusive
export const MAX_CALLS_PER_DAY = 3;
export const MAX_CALLS_PER_WEEK = 7;

export interface PrecallInput {
  readonly now: Date;
  readonly doNotCall: boolean;
  /** Demo switch: the 08:00–19:00 IST rule (RBI) is built and tested but off by default, so
   * testing works at any hour. Switch on to demo a blocked late-night call. */
  readonly callingHoursEnabled: boolean;
  /** Demo switch: attempt limits are a real rule but off by default so testing never hits them. */
  readonly callLimitsEnabled: boolean;
  readonly callsToday: number;
  readonly callsThisWeek: number;
}

export type PrecallBlockCode = 'DO_NOT_CALL' | 'OUTSIDE_CALLING_HOURS' | 'ATTEMPT_LIMIT_REACHED';

export type PrecallDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: PrecallBlockCode };

function isWithinCallingHours(now: Date): boolean {
  const hour = istHour(now);
  return hour >= CALLING_HOURS_START && hour < CALLING_HOURS_END;
}

function isOverAttemptLimit(input: PrecallInput): boolean {
  return input.callsToday >= MAX_CALLS_PER_DAY || input.callsThisWeek >= MAX_CALLS_PER_WEEK;
}

export function checkPrecall(input: PrecallInput): PrecallDecision {
  if (input.doNotCall) return { allowed: false, code: 'DO_NOT_CALL' };
  if (input.callingHoursEnabled && !isWithinCallingHours(input.now)) {
    return { allowed: false, code: 'OUTSIDE_CALLING_HOURS' };
  }
  if (input.callLimitsEnabled && isOverAttemptLimit(input)) {
    return { allowed: false, code: 'ATTEMPT_LIMIT_REACHED' };
  }
  return { allowed: true };
}
