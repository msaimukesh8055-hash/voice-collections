// supabase/functions/_shared/tools/verify-customer.ts
import { istMidnight } from '../clock.ts';
import type { ToolArgs } from './schemas.ts';
import { fail, ok, type ToolContext, type ToolOutcome } from './types.ts';

export const MAX_VERIFY_ATTEMPTS = 2;
/**
 * Failed DOB attempts allowed per customer per India day, across all calls (3 calls' worth).
 * Without it a new call token meant two fresh guesses, every time (CP1 M1).
 */
export const MAX_FAILED_VERIFY_ATTEMPTS_PER_DAY = 6;

const LOCKED_TODAY = 'Too many failed identity checks today. Share no loan details; say a ' +
  'colleague will call them back, and end the call politely.';

/** Compares against the DOB of the customer bound to the call token. Never echoes the DOB. */
export async function verifyCustomer(
  ctx: ToolContext,
  args: ToolArgs<'verify_customer'>,
): Promise<ToolOutcome> {
  const { session } = ctx;
  if (session.verified) return ok({ verified: true });
  if (session.verifyAttempts >= MAX_VERIFY_ATTEMPTS) return fail('VERIFY_LOCKED');
  // Real clock, not the demo clock: a demo clock set ahead would otherwise start the window in
  // the future and silently switch this limit off.
  const since = istMidnight(ctx.realNow);
  const failedToday = await ctx.repo.countFailedVerifyAttemptsSince(session.customerId, since);
  if (failedToday >= MAX_FAILED_VERIFY_ATTEMPTS_PER_DAY) return fail('VERIFY_LOCKED', LOCKED_TODAY);

  const verified = args.dob === session.customerDob;
  const verifyAttempts = session.verifyAttempts + 1;
  const saved = await ctx.repo.recordVerification(session.callId, { verified, verifyAttempts });
  // A parallel request spent this attempt first: don't count it twice or verify on stale state.
  if (!saved) return fail('TEMPORARY_ERROR');
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
