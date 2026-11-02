// supabase/functions/_shared/schemas/ledger.ts
// Credit-book rows as the money code sees them. Only the owner confirms money: a payment Asha
// hears about is 'claimed' and never counts towards the balance.
import { z } from 'zod';

export const LEDGER_KINDS = ['credit', 'payment'] as const;
export const LEDGER_STATUSES = ['confirmed', 'claimed', 'rejected'] as const;
export const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'cheque'] as const;

const IsoDate = z.iso.date();
/** Postgres numeric arrives as a number or a numeric string, depending on the client. */
const Rupees = z.coerce.number().positive();

export const LedgerEntrySchema = z.object({
  kind: z.enum(LEDGER_KINDS),
  amount: Rupees,
  entryDate: IsoDate,
  dueDate: IsoDate.nullable(),
  status: z.enum(LEDGER_STATUSES),
});

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
