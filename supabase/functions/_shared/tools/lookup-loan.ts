// supabase/functions/_shared/tools/lookup-loan.ts
import { requireVerified } from './guards.ts';
import type { ToolArgs } from './schemas.ts';
import { fail, ok, type ToolContext, type ToolOutcome } from './types.ts';

const LOAN_NUMBER_VISIBLE_DIGITS = 4;

export async function lookupLoan(
  ctx: ToolContext,
  _args: ToolArgs<'lookup_loan'>,
): Promise<ToolOutcome> {
  const refusal = requireVerified(ctx.session);
  if (refusal) return refusal;

  const loan = await ctx.repo.getLoanForCustomer(ctx.session.customerId);
  if (!loan) return fail('NOT_FOUND');
  return ok({
    loanNumberLast4: loan.loan_number.slice(-LOAN_NUMBER_VISIBLE_DIGITS),
    product: loan.product,
    overdueAmount: loan.overdue_amount,
    emiAmount: loan.emi_amount,
    dueDate: loan.due_date,
    daysPastDue: loan.days_past_due,
    lateFee: loan.late_fee,
  });
}
