// supabase/functions/_shared/tools/transfer-to-human.ts
// Always allowed, even before verification: a customer can always reach a person.
// Browser calls cannot be bridged, so the handoff is a callback request for the human queue.
import type { ToolArgs } from './schemas.ts';
import { ok, type ToolContext, type ToolOutcome } from './types.ts';

export async function transferToHuman(
  ctx: ToolContext,
  args: ToolArgs<'transfer_to_human'>,
): Promise<ToolOutcome> {
  await ctx.repo.insertHandoff({
    callId: ctx.session.callId,
    customerId: ctx.session.customerId,
    ...args,
  });
  return ok({
    transferred: true,
    // Not "then end the call": the voice test showed Asha hanging up in the same breath, so a
    // customer who changed their mind ("wait, I'll pay") could no longer be heard.
    nextStep: 'Tell the customer a colleague will call them back shortly and ask if there is ' +
      'anything else. Do not end the call yet. If they now want to pay, continue as normal.',
  });
}
