// supabase/functions/_shared/tools/send-payment-link.ts
// Prototype: no SMS is sent. The audit row in tool_events is the record that a link "went out".
import { checkPaymentLinkAmount } from '../compliance/promise-policy.ts';
import { requireVerified } from './guards.ts';
import type { ToolArgs } from './schemas.ts';
import { fail, ok, type ToolContext, type ToolOutcome } from './types.ts';

export async function sendPaymentLink(
  ctx: ToolContext,
  args: ToolArgs<'send_payment_link'>,
): Promise<ToolOutcome> {
  const refusal = requireVerified(ctx.session);
  if (refusal) return refusal;

  const loan = await ctx.repo.getLoanForCustomer(ctx.session.customerId);
  if (!loan) return fail('NOT_FOUND');
  const policy = checkPaymentLinkAmount(args.amount, loan.overdue_amount);
  if (!policy.ok) return fail('POLICY_REFUSED', policy.reason);

  return ok({ sent: true, channel: 'sms', sentTo: ctx.session.phoneMasked, amount: args.amount });
}
