// supabase/functions/_shared/owner-tools/prepare-send.ts
// prepare_send(what, name?) and its executor (M8 B5, Decision 3). WhatsApp only when he asks:
// this is the only way Munshi sends anything, and only after his yes. Confirm kicks the
// follow-up worker's /owner-send/<actionId> job in the background and answers at once; the
// worker builds the replies with today's WhatsApp builders and sends them once
// (reminders/owner-send.ts). munshi-tools never holds the Meta token.
// Rounds: prepare ① name (statement only) + ref ② store; confirm ② claim (+ the kick, no wait).
import {
  done,
  type Executed,
  type ExecuteInput,
  findPerson,
  LOST,
  nextRef,
  storeAction,
  type VoicePayload,
} from './actions.ts';
import type { OwnerToolArgs, SendWhat } from './schemas.ts';
import { ownerFail, ownerOk, type OwnerToolContext, type OwnerToolOutcome } from './types.ts';

export const WHOSE_STATEMENT_SAY = 'Ask him whose statement to send.';

/** What he hears: "the pending list", "Ramesh's statement", … */
export function sendLabel(what: SendWhat, name: string | null): string {
  const labels: Readonly<Record<SendWhat, string>> = {
    pending: 'the pending list',
    due: "today's due list",
    statement: name === null ? 'the statement' : `${name}'s statement`,
    insights: 'the insights',
  };
  return labels[what];
}

type Target =
  | { readonly ok: true; readonly payload: VoicePayload<'voice_send'>; readonly ref: string }
  | { readonly ok: false; readonly outcome: OwnerToolOutcome };

async function targetOf(
  ctx: OwnerToolContext,
  args: OwnerToolArgs<'prepare_send'>,
): Promise<Target> {
  if (args.what !== 'statement') {
    return {
      ok: true,
      payload: { what: args.what, shopkeeperId: null, name: null },
      ref: await nextRef(ctx),
    };
  }
  if (args.name === undefined) {
    return { ok: false, outcome: ownerFail('INVALID_ARGS', WHOSE_STATEMENT_SAY) };
  }
  const person = await findPerson(ctx, args.name);
  if (!person.ok) return person;
  const payload = { what: args.what, shopkeeperId: person.shopkeeper.id, name: person.label };
  return { ok: true, payload, ref: person.ref };
}

export async function prepareSend(
  ctx: OwnerToolContext,
  args: OwnerToolArgs<'prepare_send'>,
): Promise<OwnerToolOutcome> {
  const target = await targetOf(ctx, args);
  if (!target.ok) return target.outcome;
  const { payload, ref } = target;
  return storeAction(
    {
      kind: 'voice_send',
      payload,
      readBack: `send ${
        sendLabel(payload.what, payload.name)
      } to you on WhatsApp. Nothing goes out until he says yes and confirm_action runs.`,
      data: { what: payload.what },
    },
    ref,
    ctx,
  );
}

export async function executeSend(
  { payload, action, ctx, claim }: ExecuteInput<VoicePayload<'voice_send'>>,
): Promise<Executed> {
  if (!(await claim())) return LOST;
  ctx.writes.kickOwnerSend(action.id);
  return done(ownerOk(
    `Sending ${sendLabel(payload.what, payload.name)} on WhatsApp now. Tell him it is on its ` +
      'way, and remind him once before the goodbye.',
    { sending: payload.what },
  ));
}
