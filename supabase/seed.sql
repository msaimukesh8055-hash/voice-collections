-- supabase/seed.sql
-- FAKE DATA ONLY. Names, dates of birth and numbers are invented for the prototype.
-- Reference "today" for the story: 2026-10-31.

insert into public.customers (id, full_name, dob, phone_masked, preferred_language, city, hardship) values
  ('c0000000-0000-4000-8000-000000000001', 'Ravi Sharma',     '1988-04-12', '+91 98XXXXXX21', 'hi', 'Pune',      false),
  ('c0000000-0000-4000-8000-000000000002', 'Anita Desai',     '1991-09-03', '+91 97XXXXXX45', 'en', 'Mumbai',    false),
  ('c0000000-0000-4000-8000-000000000003', 'Mohammed Iqbal',  '1985-01-27', '+91 99XXXXXX10', 'hi', 'Lucknow',   false),
  ('c0000000-0000-4000-8000-000000000004', 'Priya Nair',      '1995-06-18', '+91 90XXXXXX88', 'en', 'Bengaluru', false),
  ('c0000000-0000-4000-8000-000000000005', 'Suresh Yadav',    '1958-11-30', '+91 94XXXXXX02', 'hi', 'Jaipur',    true),
  ('c0000000-0000-4000-8000-000000000006', 'Kavita Joshi',    '1990-02-14', '+91 93XXXXXX67', 'en', 'Nagpur',    false),
  ('c0000000-0000-4000-8000-000000000007', 'Arjun Mehta',     '1987-08-08', '+91 98XXXXXX39', 'en', 'Ahmedabad', false),
  ('c0000000-0000-4000-8000-000000000008', 'Sunita Verma',    '1983-12-05', '+91 95XXXXXX54', 'hi', 'Indore',    false);

insert into public.loans (id, customer_id, loan_number, product, emi_amount, due_date, overdue_amount, days_past_due, late_fee) values
  ('10000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'SF-PL-100234', 'personal_loan',         4200, '2026-10-05', 4200, 26, 500),
  ('10000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'SF-PL-100871', 'personal_loan',         6500, '2026-10-10', 6500, 21, 500),
  ('10000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000003', 'SF-TW-200412', 'two_wheeler_loan',      3100, '2026-10-07', 3100, 24, 300),
  ('10000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000004', 'SF-CD-300056', 'consumer_durable_loan', 2400, '2026-10-26', 2400,  5,   0),
  ('10000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000005', 'SF-PL-100109', 'personal_loan',         5200, '2026-08-30', 15600, 62, 1500),
  ('10000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000006', 'SF-PL-101002', 'personal_loan',         3800, '2026-10-15', 3800, 16, 500),
  ('10000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000007', 'SF-TW-200733', 'two_wheeler_loan',      2900, '2026-10-12', 2900, 19, 300),
  ('10000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000008', 'SF-CD-300218', 'consumer_durable_loan', 1900, '2026-10-16', 1900, 15, 200);

-- Previous calls (history for context retention) -----------------------------------------------
insert into public.calls (id, customer_id, language, verified, attempt_no, transcript, started_at, ended_at) values
  ('ca000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'hi', true, 1, '(seeded history)', '2026-10-08 11:15+05:30', '2026-10-08 11:19+05:30'),
  ('ca000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'en', true, 1, '(seeded history)', '2026-10-28 16:40+05:30', '2026-10-28 16:44+05:30'),
  ('ca000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000003', 'hi', true, 1, '(seeded history)', '2026-09-09 10:05+05:30', '2026-09-09 10:08+05:30'),
  ('ca000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000005', 'hi', true, 2, '(seeded history)', '2026-10-20 12:30+05:30', '2026-10-20 12:37+05:30'),
  ('ca000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000007', 'en', true, 1, '(seeded history)', '2026-10-22 18:10+05:30', '2026-10-22 18:14+05:30');

insert into public.promises (call_id, loan_id, amount, promise_date, payment_mode, status) values
  ('ca000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 4200, '2026-10-10', 'upi',         'broken'),
  ('ca000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 6500, '2026-11-03', 'net_banking', 'pending'),
  ('ca000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 3100, '2026-09-12', 'upi',         'kept');

insert into public.payments (loan_id, amount, paid_at, source) values
  ('10000000-0000-4000-8000-000000000003', 3100, '2026-09-12 09:30+05:30', 'seed'),
  -- Kavita paid two days ago; overdue not yet updated → exercises the "already paid" path.
  ('10000000-0000-4000-8000-000000000006', 3800, '2026-10-29 20:05+05:30', 'seed');

insert into public.customer_notes (customer_id, call_id, note, created_at) values
  ('c0000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001',
   'Promised ₹4,200 by UPI on 10 Oct; payment not received — promise broken. Next call: ask what happened, offer part payment, keep tone calm.',
   '2026-10-11 09:00+05:30'),
  ('c0000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000002',
   'Promised full ₹6,500 via net banking on 3 Nov (salary date). Cooperative. Promise check scheduled for 4 Nov.',
   '2026-10-28 16:45+05:30'),
  ('c0000000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000003',
   'Paid September EMI on the promised date. Reliable payer; October EMI now overdue.',
   '2026-09-13 09:00+05:30'),
  ('c0000000-0000-4000-8000-000000000005', 'ca000000-0000-4000-8000-000000000005',
   'Mentioned ongoing medical expenses for spouse; marked hardship. Speak slowly, offer human support and hardship options before any payment ask.',
   '2026-10-20 12:40+05:30'),
  ('c0000000-0000-4000-8000-000000000007', 'ca000000-0000-4000-8000-000000000007',
   'Disputes the ₹300 late fee, says the auto-debit failed on the bank side. Handed to a human; dispute still open.',
   '2026-10-22 18:15+05:30');

insert into public.handoffs (call_id, customer_id, reason, summary, status) values
  ('ca000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000007', 'dispute',
   'Customer disputes the late fee; claims auto-debit failure on bank side. Needs bank statement check.', 'open');

insert into public.followups (customer_id, scheduled_for, reason) values
  ('c0000000-0000-4000-8000-000000000002', '2026-11-04 10:00+05:30', 'promise_check');

insert into public.demo_settings (id, demo_clock) values (1, null);
