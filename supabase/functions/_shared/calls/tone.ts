// supabase/functions/_shared/calls/tone.ts
// Tone ladder (SPEC §7.4, M5 Decision 2). The level is worked out here, from broken promises
// (last 6 months) and days overdue, and passed to Asha: the AI never decides how hard to push.
// The level-3 consequence is said only when the owner set one.
import { isWithinHistory } from '../ledger/history.ts';
import type { PromiseRecord } from '../ledger/promise-check.ts';

export type ToneLevel = 1 | 2 | 3;

export const TONE_RULES = {
  firmBrokenPromises: 1,
  firmDaysOverdue: 15,
  firmerBrokenPromises: 2,
  firmerDaysOverdue: 30,
} as const;

export const TONE_NAMES = { 1: 'friendly', 2: 'firm', 3: 'firmer' } as const satisfies Readonly<
  Record<ToneLevel, string>
>;

export interface ToneInputs {
  readonly brokenPromises: number;
  readonly daysOverdue: number;
}

export function countRecentBroken(promises: readonly PromiseRecord[], today: string): number {
  return promises.filter((promise) =>
    promise.status === 'broken' && isWithinHistory(promise.promiseDate, today)
  ).length;
}

export function toneLevel(inputs: ToneInputs): ToneLevel {
  const { brokenPromises, daysOverdue } = inputs;
  if (
    brokenPromises >= TONE_RULES.firmerBrokenPromises ||
    daysOverdue >= TONE_RULES.firmerDaysOverdue
  ) return 3;
  if (
    brokenPromises >= TONE_RULES.firmBrokenPromises || daysOverdue >= TONE_RULES.firmDaysOverdue
  ) return 2;
  return 1;
}

/** The owner's consequence text, at level 3 only; null when not set (SPEC §7.4). */
export function consequenceFor(level: ToneLevel, ownerText: string | null): string | null {
  if (level !== 3) return null;
  const text = ownerText?.trim() ?? '';
  return text === '' ? null : text;
}
