// supabase/functions/_shared/schemas/ledger.ts
// Credit-book rows as the money code sees them. Only the owner confirms money: a payment Asha
// hears about is 'claimed' and never counts towards the balance. M8: an entry Munshi deletes is
// 'reversed' (kept, never counted).
import { z } from 'zod';

export const LEDGER_KINDS = ['credit', 'payment'] as const;
export const LEDGER_STATUSES = ['confirmed', 'claimed', 'rejected', 'reversed'] as const;
export const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'cheque'] as const;
/** open → kept or broken (promise checker, M5); replaced when a newer promise is made. */
export const PROMISE_STATUSES = ['open', 'kept', 'broken', 'replaced'] as const;

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
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export type PromiseStatus = (typeof PROMISE_STATUSES)[number];
