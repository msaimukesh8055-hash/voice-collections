// supabase/functions/_shared/tools/request-owner-callback.ts
// Always allowed, even before (or after a failed) identity check: a son can ask the owner to
// call his father. The reply shares nothing about dues. M5 turns the row into a WhatsApp flag.
import type { ToolArgs } from './schemas.ts';
import { ok, type ToolContext, type ToolOutcome } from './types.ts';

// Not "then end the call": in M2 testing Asha hung up in the same breath as a handover, so a
// shopkeeper who changed their mind could no longer be heard.
const SAY =
  'Callback request saved. Tell them the owner will call them back. Ask if there is anything ' +
  'else; do not end the call in the same reply.';

export async function requestOwnerCallback(
  ctx: ToolContext,
  args: ToolArgs<'request_owner_callback'>,
): Promise<ToolOutcome> {
  await ctx.repo.insertOwnerCallback({
    callId: ctx.session.callId,
    shopkeeperId: ctx.session.shopkeeperId,
    reason: args.reason,
    summary: args.summary,
  });
  return ok(SAY, { saved: true });
}
