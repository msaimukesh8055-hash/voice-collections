// supabase/functions/_shared/owner-tools/prepare-remind.ts
// prepare_remind(name) and its executor (M8 B4). The read-back says Asha calls right after this
// call; the pre-call rules (do not call, calling hours, attempt limits, rate limit) run at
// confirm, through the one queueCall({mode: 'live'}) WhatsApp's Remind uses, so they cannot be
// skipped. While the Munshi call is live the phone line is busy (calls/live-line.ts), so Asha
// rings /phone only after he hangs up. A blocked call is told in plain words (the same English
// lines as WhatsApp's) and nothing is queued.
// Rounds: prepare ① name + ref ② store; confirm ② claim ③ queueCall (its own reads).
// Once queued, the owner also gets the phone-page link on WhatsApp (Saim, 2026-11-23), the same
// "📞 Calling X… Answer here: <link>" that WhatsApp's Remind sends, through the owner-send job.
import { reminderPhrasesFor } from '../reminders/phrases.ts';
import {
  done,
  type Executed,
  type ExecuteInput,
  findPerson,
  LOST,
  refused,
  storeAction,
  type VoicePayload,
} from './actions.ts';
import type { OwnerToolArgs } from './schemas.ts';
import { ownerFail, ownerOk, type OwnerToolContext, type OwnerToolOutcome } from './types.ts';

export async function prepareRemind(
  ctx: OwnerToolContext,
  args: OwnerToolArgs<'prepare_remind'>,
): Promise<OwnerToolOutcome> {
  const person = await findPerson(ctx, args.name);
  if (!person.ok) return person.outcome;
  const { shopkeeper, label, ref } = person;
  return storeAction(
    {
      kind: 'voice_remind',
      payload: { shopkeeperId: shopkeeper.id, name: label },
      readBack: `Asha will call ${label} right after this call ends.`,
      data: { shopkeeper: shopkeeper.name },
    },
    ref,
    ctx,
  );
}

export async function executeRemind(
  { payload, action, ctx, claim }: ExecuteInput<VoicePayload<'voice_remind'>>,
): Promise<Executed> {
  if (!(await claim())) return LOST;
  const result = await ctx.writes.queueCall(payload.shopkeeperId);
  if (!result.ok) {
    const reason = reminderPhrasesFor('en').blocked(result.code, payload.name);
    return refused(ownerFail('CALL_BLOCKED', `${reason} Tell him that simply.`));
  }
  ctx.writes.kickOwnerSend(action.id);
  const say = result.alreadyQueued
    ? `Asha is already set to call ${payload.name}; she rings right after this call ends.`
    : `Done: Asha will call ${payload.name} right after this call ends. Tell him that.`;
  return done(ownerOk(say, { queued: true, already_queued: result.alreadyQueued }));
}
