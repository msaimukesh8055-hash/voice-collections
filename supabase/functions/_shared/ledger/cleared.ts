// supabase/functions/_shared/ledger/cleared.ts
// When each credit was paid off, for the "closed" view (SPEC §6.1). Same rules as dues.ts:
// confirmed entries only, payments clear the oldest credit first. Here payments are applied one
// by one in date order, so a credit's "cleared on" date is the day of the payment that finished it.
import type { LedgerEntry } from '../schemas/ledger.ts';
import { byOldestFirst, dueDateOf, toPaise } from './dues.ts';

export interface ClearedCredit {
  readonly amount: number;
  readonly entryDate: string;
  readonly dueDate: string;
  readonly clearedOn: string;
}

interface Open {
  readonly entry: LedgerEntry;
  readonly left: number;
}

interface Step {
  readonly open: readonly Open[];
  readonly cleared: readonly ClearedCredit[];
}

function applyPayment(step: Step, payment: LedgerEntry): Step {
  let paise = toPaise(payment.amount);
  const cleared: ClearedCredit[] = [];
  const open = step.open.flatMap((credit): Open[] => {
    const used = Math.min(credit.left, paise);
    paise -= used;
    if (credit.left - used > 0) return [{ entry: credit.entry, left: credit.left - used }];
    cleared.push({
      amount: credit.entry.amount,
      entryDate: credit.entry.entryDate,
      dueDate: dueDateOf(credit.entry),
      clearedOn: payment.entryDate,
    });
    return [];
  });
  return { open, cleared: [...step.cleared, ...cleared] };
}

/** Credits fully paid off, with the date the last payment landed. */
export function clearedCredits(entries: readonly LedgerEntry[]): readonly ClearedCredit[] {
  const confirmed = entries.filter((entry) => entry.status === 'confirmed');
  const credits = confirmed.filter((entry) => entry.kind === 'credit').sort(byOldestFirst);
  const payments = confirmed
    .filter((entry) => entry.kind === 'payment')
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const start: Step = {
    open: credits.map((entry) => ({ entry, left: toPaise(entry.amount) })),
    cleared: [],
  };
  return payments.reduce(applyPayment, start).cleared;
}
