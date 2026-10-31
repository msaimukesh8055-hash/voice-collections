// supabase/functions/_shared/schemas/loan.ts
import { z } from 'zod';

const RupeeAmount = z.number().nonnegative();

export const LoanSchema = z.object({
  id: z.uuid(),
  customer_id: z.uuid(),
  loan_number: z.string().trim().min(1),
  product: z.enum(['personal_loan', 'two_wheeler_loan', 'consumer_durable_loan']),
  emi_amount: RupeeAmount,
  due_date: z.iso.date(),
  overdue_amount: RupeeAmount,
  days_past_due: z.number().int().nonnegative(),
  late_fee: RupeeAmount,
});

export type Loan = z.infer<typeof LoanSchema>;
