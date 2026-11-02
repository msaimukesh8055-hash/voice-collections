// supabase/functions/_shared/tools/verify-customer.ts
import type { ToolArgs } from './schemas.ts';
import { fail, ok, type ToolContext, type ToolOutcome } from './types.ts';

export const MAX_VERIFY_ATTEMPTS = 2;

/** Compares against the DOB of the customer bound to the call token. Never echoes the DOB. */
export async function verifyCustomer(
  ctx: ToolContext,
  args: ToolArgs<'verify_customer'>,
): Promise<ToolOutcome> {
  const { session } = ctx;
  if (session.verified) return ok({ verified: true });
  if (session.verifyAttempts >= MAX_VERIFY_ATTEMPTS) return fail('VERIFY_LOCKED');

  const verified = args.dob === session.customerDob;
  const verifyAttempts = session.verifyAttempts + 1;
  await ctx.repo.recordVerification(session.callId, { verified, verifyAttempts });
  const next = { ...session, verified, verifyAttempts };
  if (verified) return { ...ok({ verified: true }), session: next };

  const attemptsLeft = MAX_VERIFY_ATTEMPTS - verifyAttempts;
  // Say "does not match", never "could not hear": the voice test showed the LLM blaming its
  // hearing for a wrong date, which confuses the caller.
  const nextStep = attemptsLeft > 0
    ? 'The date of birth does not match our records. Tell the customer it does not match and ' +
      'ask them to check and say it again. Do not say you could not hear or understand them.'
    : 'The date of birth did not match again. Share no loan details. Say you cannot verify ' +
      'their identity on this call, a colleague will help, and end the call politely.';
  return { ...ok({ verified: false, attemptsLeft, nextStep }), session: next };
}
