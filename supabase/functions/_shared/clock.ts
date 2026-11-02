// supabase/functions/_shared/clock.ts
// "Now" for compliance decisions. India has no daylight saving, so IST is a fixed UTC+5:30.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The demo clock (when set) overrides real time, so blocked-hour calls can be shown on demo day. */
export function resolveNow(demoClock: string | null, realNow: Date): Date {
  return demoClock === null ? realNow : new Date(demoClock);
}

function toIst(instant: Date): Date {
  return new Date(instant.getTime() + IST_OFFSET_MS);
}

export function istHour(instant: Date): number {
  return toIst(instant).getUTCHours();
}

/** India calendar date as YYYY-MM-DD. */
export function istDate(instant: Date): string {
  return toIst(instant).toISOString().slice(0, 10);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** e.g. "Sunday, 2026-11-01": lets the LLM turn "next Friday" into a date the policy accepts. */
export function istDayLabel(instant: Date): string {
  return `${WEEKDAYS[toIst(instant).getUTCDay()]}, ${istDate(instant)}`;
}

/** Start of the India day containing `instant`, as a UTC instant. */
export function istMidnight(instant: Date): Date {
  return new Date(Date.parse(`${istDate(instant)}T00:00:00Z`) - IST_OFFSET_MS);
}

/** Calendar arithmetic on YYYY-MM-DD dates. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
