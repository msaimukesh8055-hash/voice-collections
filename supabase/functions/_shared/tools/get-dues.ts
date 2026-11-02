// supabase/functions/_shared/tools/get-dues.ts
// What the shopkeeper owes, from confirmed ledger entries only. Memory and tone level are
// placeholders until M5 (SPEC §7.3, §7.4).
import { istDate } from '../clock.ts';
import { formatDay, formatRupees } from '../format.ts';
import { computeDues, type Dues } from '../ledger/dues.ts';
import { requireIdentity } from './guards.ts';
import type { ToolArgs } from './schemas.ts';
import { ok, type ToolContext, type ToolOutcome } from './types.ts';

const FRIENDLY_TONE_LEVEL = 1;
const NOTHING_OWED = 'Nothing is outstanding. Thank them; there is nothing to collect today.';
const CLOSING = "Say these figures once, in the caller's language, then ask when they can pay.";

function overdueLine(dues: Dues): string {
  if (dues.overdueAmount === 0 || dues.oldestDueDate === null) return 'Nothing is overdue yet.';
  return `Overdue: ${formatRupees(dues.overdueAmount)}, due since ` +
    `${formatDay(dues.oldestDueDate)} (${dues.daysOverdue} days).`;
}

function nextDueLine(dues: Dues): string {
  if (dues.nextDueDate === null) return '';
  return ` Next due: ${formatRupees(dues.nextDueAmount)} on ${formatDay(dues.nextDueDate)}.`;
}

export function describeDues(dues: Dues): string {
  if (dues.outstanding === 0) return NOTHING_OWED;
  return `Total outstanding: ${formatRupees(dues.outstanding)}. ${overdueLine(dues)}` +
    `${nextDueLine(dues)} ${CLOSING}`;
}

export async function getDues(
  ctx: ToolContext,
  _args: ToolArgs<'get_dues'>,
): Promise<ToolOutcome> {
  const refusal = requireIdentity(ctx.session);
  if (refusal) return refusal;

  const dues = computeDues(await ctx.repo.getLedger(ctx.session.shopkeeperId), istDate(ctx.now));
  return ok(describeDues(dues), {
    outstanding: dues.outstanding,
    overdue_amount: dues.overdueAmount,
    oldest_due_date: dues.oldestDueDate,
    days_overdue: dues.daysOverdue,
    next_due_date: dues.nextDueDate,
    next_due_amount: dues.nextDueAmount,
    memory: null,
    tone_level: FRIENDLY_TONE_LEVEL,
  });
}
