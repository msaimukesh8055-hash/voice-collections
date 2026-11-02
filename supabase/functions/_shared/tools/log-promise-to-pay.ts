// supabase/functions/_shared/tools/log-promise-to-pay.ts
import { istDate } from '../clock.ts';
import { checkPromise } from '../compliance/promise-policy.ts';
import { requireVerified } from './guards.ts';
import type { ToolArgs } from './schemas.ts';
import { fail, ok, type ToolContext, type ToolOutcome } from './types.ts';

export async function logPromiseToPay(
  ctx: ToolContext,
  args: ToolArgs<'log_promise_to_pay'>,
): Promise<ToolOutcome> {
  const refusal = requireVerified(ctx.session);
  if (refusal) return refusal;

  const loan = await ctx.repo.getLoanForCustomer(ctx.session.customerId);
  if (!loan) return fail('NOT_FOUND');
  const policy = checkPromise({
    amount: args.amount,
    promiseDate: args.promiseDate,
    overdueAmount: loan.overdue_amount,
    today: istDate(ctx.now),
  });
  if (!policy.ok) return fail('POLICY_REFUSED', policy.reason);

  await ctx.repo.insertPromise({ callId: ctx.session.callId, loanId: loan.id, ...args });
  return ok({ logged: true, ...args });
}
