// supabase/functions/_shared/followup/said-check.ts
// CP3 B-H2 (Saim, 2026-11-20: "drop just the unchecked line"): the after-call WhatsApp summary's
// "Summary" lines are written by the LLM, so each line is checked in code before it is sent. A
// line is kept only when every figure in it (amounts, dates, any number) is one of the call's
// own: the saved promise, the payment claim, today's date, or something said on the call. A
// figure written in words ("5 thousand") cannot be checked, so its line is dropped too. Only that
// line goes; the rest of the summary is unchanged. Pure code, no LLM.
import { formatInr, formatShortDay } from '../format.ts';
import { hasScaleWord, numbersIn } from '../figure-words.ts';
import type { CallFacts } from './facts.ts';

/** Everything a summary line may take a figure from. */
function sourceText(facts: CallFacts): string {
  const { promise, claim } = facts;
  return [
    promise ? `${formatInr(promise.amount)} ${formatShortDay(promise.promiseDate)}` : '',
    claim ? `${formatInr(claim.amount)} ${formatShortDay(claim.paidDate)}` : '',
    formatShortDay(facts.today),
    String(facts.daysOverdue),
    ...(facts.transcript ?? []).map((turn) => turn.content),
  ].join('\n');
}

/** The lines whose figures all come from the call; the others are left out. */
export function checkedSaidLines(lines: readonly string[], facts: CallFacts): string[] {
  const allowed = new Set(numbersIn(sourceText(facts)));
  return lines.filter(function checked(line): boolean {
    if (hasScaleWord(line)) return false;
    return numbersIn(line).every((number) => allowed.has(number));
  });
}
