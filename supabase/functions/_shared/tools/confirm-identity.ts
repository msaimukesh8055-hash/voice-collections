// supabase/functions/_shared/tools/confirm-identity.ts
// Identity check (SPEC D2, M3 Decision 9): the person confirms name + shop before any amount.
// Confirmed → amounts allowed for the rest of the call. Denied → locked for this call.
// Unsure twice → treated as denied. Asking again after "confirmed" is answered without a write,
// which stops the identity question restarting mid-call (seen in testing).
import type { Identity } from '../db/repository.ts';
import type { ToolArgs } from './schemas.ts';
import { fail, ok, type ToolContext, type ToolOutcome } from './types.ts';

export const MAX_UNSURE_ANSWERS = 2;

const SAY = {
  alreadyConfirmed: 'Identity is already confirmed. Do not ask again; continue the call.',
  confirmed:
    'Identity confirmed. Now give the recording notice and ask if they have two minutes, then ' +
    'call get_dues.',
  denied:
    'This person is not the shopkeeper. Share nothing about dues or amounts. Apologise, offer ' +
    'that the owner can call back if they want, and end the call politely.',
  unsure: 'The answer was not clear. Ask once more, politely, whether you are speaking with the ' +
    'shopkeeper of this shop.',
} as const;

function nextIdentity(current: Identity, answer: ToolArgs<'confirm_identity'>['answer']): Identity {
  if (answer !== 'unsure') return { status: answer, unsureCount: current.unsureCount };
  const unsureCount = current.unsureCount + 1;
  return { status: unsureCount >= MAX_UNSURE_ANSWERS ? 'denied' : 'unknown', unsureCount };
}

export async function confirmIdentity(
  ctx: ToolContext,
  args: ToolArgs<'confirm_identity'>,
): Promise<ToolOutcome> {
  const { session } = ctx;
  if (session.identityStatus === 'confirmed') {
    return ok(SAY.alreadyConfirmed, { identity: 'confirmed' });
  }
  if (session.identityStatus === 'denied') return fail('IDENTITY_DENIED');

  const current = { status: session.identityStatus, unsureCount: session.identityUnsureCount };
  const next = nextIdentity(current, args.answer);
  // A parallel request changed identity first: don't decide on stale state.
  if (!(await ctx.repo.recordIdentity(session.callId, current, next))) {
    return fail('TEMPORARY_ERROR');
  }

  const updated = {
    ...session,
    identityStatus: next.status,
    identityUnsureCount: next.unsureCount,
  };
  const say = next.status === 'unknown' ? SAY.unsure : SAY[next.status];
  return { ...ok(say, { identity: next.status }), session: updated };
}
