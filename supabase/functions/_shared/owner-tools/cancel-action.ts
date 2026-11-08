// supabase/functions/_shared/owner-tools/cancel-action.ts
// cancel_action (M8 B1): he said no, or is unsure. Closes this call's open change in one round
// (there is at most one; the ref is not needed to cancel). Nothing in the book changes.
// ⚠️ The wording is what the LLM reads: drafts for Saim.
import type { OwnerToolArgs } from './schemas.ts';
import { ownerOk, type OwnerToolContext, type OwnerToolOutcome } from './types.ts';

export const CANCELLED_SAY = 'Cancelled. Nothing changed in the book.';
export const NOTHING_WAITING_SAY = 'Nothing was waiting for his yes. Nothing changed in the book.';

export async function cancelAction(
  ctx: OwnerToolContext,
  _args: OwnerToolArgs<'cancel_action'>,
): Promise<OwnerToolOutcome> {
  // Everything prepared up to this moment (inclusive) is cancelled.
  const upTo = new Date(ctx.realNow.getTime() + 1).toISOString();
  const cancelled = await ctx.writes.actions.cancelOpenVoiceActions(ctx.ownerCall.id, upTo);
  return ownerOk(cancelled > 0 ? CANCELLED_SAY : NOTHING_WAITING_SAY, { cancelled });
}
