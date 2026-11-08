// supabase/functions/_shared/owner-tools/read-back.ts
// How Munshi's prepare and confirm replies are worded (M8 Build B): English facts with figures
// formatted in code (Munshi speaks them in his language, as for the reads). A read-back always
// names the person and the amount, so a wrong yes is audible (M8-R1). Sarvam passes only `say`
// to the LLM, so the action_ref it must copy is inside the text.
// ⚠️ This wording is what the LLM reads: drafts for Saim.
import { formatRupees, formatShortDay } from '../format.ts';
import type { LedgerKind } from '../schemas/ledger.ts';

export function askForYes(readBack: string, ref: string): string {
  return `Read this back to him and ask "correct?": ${readBack} Then stop and wait for his ` +
    `answer. Only if he says yes to this, call confirm_action with action_ref ${ref}.`;
}

/** "His balance goes from 8,500 rupees to 13,500 rupees." / "His balance stays …". */
export function balanceChange(before: number, after: number): string {
  if (before === after) return `His balance stays ${formatRupees(before)}.`;
  return `His balance goes from ${formatRupees(before)} to ${formatRupees(after)}.`;
}

/** "His balance is now 13,500 rupees." */
export function balanceNow(outstanding: number): string {
  return `His balance is now ${formatRupees(outstanding)}.`;
}

/** "credit of 5,000 rupees on Tue 6 Oct" */
export function entryLine(entry: {
  readonly kind: LedgerKind;
  readonly amount: number;
  readonly entryDate: string;
}): string {
  return `${entry.kind} of ${formatRupees(entry.amount)} on ${formatShortDay(entry.entryDate)}`;
}
