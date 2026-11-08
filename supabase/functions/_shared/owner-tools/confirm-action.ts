// supabase/functions/_shared/owner-tools/confirm-action.ts
// confirm_action(action_ref) (M8 B1, Decision 5): the lock on every spoken change. The prompt
// asks for his yes; this code decides whether a yes can count. It runs only this call's newest
// voice action, while it is open and unexpired, at least MIN_CONFIRM_DELAY_MS after its prepare,
// and only when the ref matches. Then the compare-and-set open → saved (alongside the executor's
// first read), so of two confirms only one writes. If the write fails, the action goes back to
// open (he can say yes again); if the executor refuses (e.g. a blocked call), it is closed.
// Two prepares that ran at once can get the same ref (it comes from a count); the LLM then heard
// two read-backs with one ref, so a yes cannot tell which one he meant: both are dropped.
// Rounds: ① the newest actions ② claim + read ③ the write (auth is one more, in the handler).
import type { z } from 'zod';
import type { VoiceAction, VoiceActionKind } from '../db/voice-action-repository.ts';
import {
  type Executed,
  type Executor,
  MIN_CONFIRM_DELAY_MS,
  normaliseRef,
  refused,
  VOICE_PAYLOADS,
} from './actions.ts';
import { executeClaim } from './prepare-claim.ts';
import { executeCredit } from './prepare-credit.ts';
import { executeDelete } from './prepare-delete.ts';
import { executePayment } from './prepare-payment.ts';
import { executeRemind } from './prepare-remind.ts';
import { executeSend } from './prepare-send.ts';
import type { OwnerToolArgs } from './schemas.ts';
import { ownerFail, type OwnerToolContext, type OwnerToolOutcome } from './types.ts';

interface RunnableExecutor {
  run(action: VoiceAction, ctx: OwnerToolContext, claim: () => Promise<boolean>): Promise<Executed>;
}

/** The kind's payload is parsed again before anything runs: never trust a stored row. */
function runnable<S extends z.ZodType>(schema: S, execute: Executor<z.infer<S>>): RunnableExecutor {
  return {
    run(action, ctx, claim): Promise<Executed> {
      const payload = schema.safeParse(action.data);
      if (!payload.success) return Promise.resolve(refused(ownerFail('TEMPORARY_ERROR')));
      return execute({ payload: payload.data, action, ctx, claim });
    },
  };
}

/** Typed kind → executor map (no switch). */
const EXECUTORS: { readonly [K in VoiceActionKind]: RunnableExecutor } = {
  voice_credit: runnable(VOICE_PAYLOADS.voice_credit, executeCredit),
  voice_payment: runnable(VOICE_PAYLOADS.voice_payment, executePayment),
  voice_delete: runnable(VOICE_PAYLOADS.voice_delete, executeDelete),
  voice_remind: runnable(VOICE_PAYLOADS.voice_remind, executeRemind),
  voice_claim: runnable(VOICE_PAYLOADS.voice_claim, executeClaim),
  voice_send: runnable(VOICE_PAYLOADS.voice_send, executeSend),
};

type Gate =
  | { readonly ok: true; readonly action: VoiceAction }
  | { readonly ok: false; readonly outcome: OwnerToolOutcome };

function refuse(code: Parameters<typeof ownerFail>[0]): Gate {
  return { ok: false, outcome: ownerFail(code) };
}

/** A closed action: done already (same ref), dropped for time (same ref), or nothing waiting. */
function closedGate(action: VoiceAction, sameRef: boolean): Gate {
  const isDone = action.status === 'saved' || action.status === 'done';
  if (isDone && sameRef) return refuse('ALREADY_DONE');
  if (action.status === 'expired' && sameRef) return refuse('ACTION_EXPIRED');
  return refuse('NO_OPEN_ACTION');
}

export const TWIN_REF_SAY = 'Two changes were got ready at once, so neither was done and both ' +
  'were dropped. Get one change ready at a time: call the prepare tool again and read it back.';

async function gate(
  [action, previous]: readonly VoiceAction[],
  ref: string,
  ctx: OwnerToolContext,
): Promise<Gate> {
  if (!action) return refuse('NO_OPEN_ACTION');
  const sameRef = action.ref === ref;
  if (action.status !== 'open') return closedGate(action, sameRef);
  if (!sameRef) return refuse('WRONG_REF');
  if (previous?.ref === action.ref) {
    const upTo = new Date(ctx.realNow.getTime() + 1).toISOString();
    await ctx.writes.actions.cancelOpenVoiceActions(ctx.ownerCall.id, upTo);
    return { ok: false, outcome: ownerFail('WRONG_REF', TWIN_REF_SAY) };
  }
  const now = ctx.realNow.getTime();
  if (now >= Date.parse(action.expiresAt)) {
    await ctx.writes.actions.transitionVoiceAction(action.id, 'open', 'expired');
    return refuse('ACTION_EXPIRED');
  }
  if (now - Date.parse(action.createdAt) < MIN_CONFIRM_DELAY_MS) {
    // Dropped, not left open: a retry a moment later would otherwise pass with no yes from him
    // (M8 Build B test finding). He hears the read-back again from a fresh prepare.
    await ctx.writes.actions.transitionVoiceAction(action.id, 'open', 'cancelled');
    return refuse('TOO_SOON');
  }
  return { ok: true, action };
}

async function execute(action: VoiceAction, ctx: OwnerToolContext): Promise<OwnerToolOutcome> {
  const { actions } = ctx.writes;
  let won = false;
  async function claim(): Promise<boolean> {
    won = await actions.transitionVoiceAction(action.id, 'open', 'saved');
    return won;
  }
  let executed: Executed;
  try {
    executed = await EXECUTORS[action.kind].run(action, ctx, claim);
  } catch (error) {
    // Only the run that won the claim may reopen it (never the winner's action).
    if (won) await actions.transitionVoiceAction(action.id, 'saved', 'open');
    throw error;
  }
  if (executed.status === 'lost') return ownerFail('ALREADY_DONE');
  if (executed.status === 'refused') {
    await actions.transitionVoiceAction(action.id, won ? 'saved' : 'open', 'cancelled');
  }
  return executed.outcome;
}

export async function confirmAction(
  ctx: OwnerToolContext,
  args: OwnerToolArgs<'confirm_action'>,
): Promise<OwnerToolOutcome> {
  const newest = await ctx.writes.actions.latestVoiceActions(ctx.ownerCall.id);
  const checked = await gate(newest, normaliseRef(args.action_ref), ctx);
  if (!checked.ok) return checked.outcome;
  return execute(checked.action, ctx);
}
