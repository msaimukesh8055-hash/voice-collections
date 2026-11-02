// supabase/functions/_shared/tools/record-payment-claim.ts
// "I already paid": saved as a 'claimed' payment for the owner to confirm. It never changes the
// balance (only confirmed entries count, see ledger/dues.ts): Asha records what she heard;
// Srinivas confirms what he received. Once per call, backed by a database rule.
import { istDate } from '../clock.ts';
import { checkPaymentClaim } from '../compliance/promise-policy.ts';
import type { SavedClaim } from '../db/repository.ts';
import { formatDay, formatRupees } from '../format.ts';
import { computeDues } from '../ledger/dues.ts';
import { requireIdentity } from './guards.ts';
import type { ToolArgs } from './schemas.ts';
import { fail, ok, type ToolContext, type ToolOutcome } from './types.ts';

const MODE_WORDS = {
  cash: 'cash',
  upi: 'UPI',
  bank_transfer: 'bank transfer',
  cheque: 'cheque',
} as const satisfies Record<SavedClaim['mode'], string>;

function describe(claim: SavedClaim): string {
  return `${formatRupees(claim.amount)} paid by ${MODE_WORDS[claim.mode]} on ${
    formatDay(claim.paidDate)
  }`;
}

function claimData(claim: SavedClaim): Record<string, string | number> {
  return { amount: claim.amount, paid_date: claim.paidDate, mode: claim.mode };
}

function alreadySaved(claim: SavedClaim): ToolOutcome {
  return ok(
    `A payment claim is already recorded on this call: ${describe(claim)}. Do not record ` +
      'another; say the owner will confirm it.',
    { saved: false, already_saved: true, ...claimData(claim) },
  );
}

export async function recordPaymentClaim(
  ctx: ToolContext,
  args: ToolArgs<'record_payment_claim'>,
): Promise<ToolOutcome> {
  const refusal = requireIdentity(ctx.session);
  if (refusal) return refusal;

  const { callId, shopkeeperId } = ctx.session;
  const [ledger, existing] = await Promise.all([
    ctx.repo.getLedger(shopkeeperId),
    ctx.repo.getClaimForCall(callId),
  ]);
  if (existing) return alreadySaved(existing);

  const today = istDate(ctx.now);
  const claim: SavedClaim = { amount: args.amount, paidDate: args.paid_date, mode: args.mode };
  const policy = checkPaymentClaim({
    ...claim,
    outstanding: computeDues(ledger, today).outstanding,
    today,
  });
  if (!policy.ok) return fail('POLICY_REFUSED', policy.reason);

  if (!(await ctx.repo.insertPaymentClaim({ callId, shopkeeperId, ...claim }))) {
    const winner = await ctx.repo.getClaimForCall(callId);
    return winner ? alreadySaved(winner) : fail('TEMPORARY_ERROR');
  }
  return ok(
    `Claim recorded for the owner to confirm: ${describe(claim)}. Do not say the balance has ` +
      'gone down. Say you will ask the owner to confirm it.',
    { saved: true, ...claimData(claim) },
  );
}
