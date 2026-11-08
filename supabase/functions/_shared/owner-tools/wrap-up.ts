// supabase/functions/_shared/owner-tools/wrap-up.ts
// The 1-minute warning in code (M8): Sarvam ends a Munshi call at 8 minutes and cannot inject a
// timed message, so from 7:00 after Start call every tool reply carries a note to wrap up. The
// page shows "1 minute left" at the same time. Real clock: accepted_at is a real timestamp.
// ⚠️ The note is prompt text: Saim's approved wording (M8 plan).
import type { ToolResult } from '../tools/types.ts';

export const WRAP_UP_AFTER_MS = 7 * 60_000;
export const WRAP_UP_NOTE =
  'Time is nearly up on this call: finish this, tell him, and ask your closing question.';

export function isWrapUpTime(acceptedAt: string | null, realNow: Date): boolean {
  if (acceptedAt === null) return false;
  return realNow.getTime() - Date.parse(acceptedAt) >= WRAP_UP_AFTER_MS;
}

/** The same result, its `say` ending with the wrap-up note once it is time. */
export function withWrapUp<C extends string>(
  result: ToolResult<C>,
  acceptedAt: string | null,
  realNow: Date,
): ToolResult<C> {
  if (!isWrapUpTime(acceptedAt, realNow)) return result;
  return { ...result, say: `${result.say} ${WRAP_UP_NOTE}` };
}
