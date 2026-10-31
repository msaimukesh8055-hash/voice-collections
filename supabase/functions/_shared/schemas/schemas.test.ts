// supabase/functions/_shared/schemas/schemas.test.ts
import { assertEquals } from '@std/assert';
import { CustomerSchema } from './customer.ts';
import { LoanSchema } from './loan.ts';

const VALID_CUSTOMER = {
  id: '11111111-1111-4111-8111-111111111111',
  full_name: 'Ravi Sharma',
  dob: '1988-04-12',
  phone_masked: '+91 98XXXXXX21',
  preferred_language: 'hi',
  city: 'Pune',
  do_not_call: false,
  hardship: false,
};

const VALID_LOAN = {
  id: '22222222-2222-4222-8222-222222222222',
  customer_id: VALID_CUSTOMER.id,
  loan_number: 'SF-PL-100234',
  product: 'personal_loan',
  emi_amount: 4200,
  due_date: '2026-10-05',
  overdue_amount: 4200,
  days_past_due: 26,
  late_fee: 500,
};

Deno.test('CustomerSchema › accepts a seed-shaped customer', () => {
  assertEquals(CustomerSchema.safeParse(VALID_CUSTOMER).success, true);
});

Deno.test('CustomerSchema › rejects an unsupported language code', () => {
  const result = CustomerSchema.safeParse({ ...VALID_CUSTOMER, preferred_language: 'te' });
  assertEquals(result.success, false);
});

Deno.test('CustomerSchema › rejects a non-ISO date of birth', () => {
  const result = CustomerSchema.safeParse({ ...VALID_CUSTOMER, dob: '12/04/1988' });
  assertEquals(result.success, false);
});

Deno.test('LoanSchema › accepts a seed-shaped loan', () => {
  assertEquals(LoanSchema.safeParse(VALID_LOAN).success, true);
});

Deno.test('LoanSchema › rejects a negative overdue amount', () => {
  const result = LoanSchema.safeParse({ ...VALID_LOAN, overdue_amount: -1 });
  assertEquals(result.success, false);
});

Deno.test('LoanSchema › rejects negative days past due', () => {
  const result = LoanSchema.safeParse({ ...VALID_LOAN, days_past_due: -3 });
  assertEquals(result.success, false);
});
