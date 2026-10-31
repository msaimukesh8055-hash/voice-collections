-- supabase/migrations/20261031000001_schema.sql
-- Core schema for the Suvidha Finance voice collections prototype (SPEC §10). Fake data only.

create extension if not exists vector with schema extensions;

-- Customers and loans: the fake "core banking" system ---------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  dob date not null,
  phone_masked text not null,
  preferred_language text not null check (preferred_language in ('en', 'hi')),
  city text not null,
  do_not_call boolean not null default false,
  hardship boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  loan_number text not null unique,
  product text not null check (product in ('personal_loan', 'two_wheeler_loan', 'consumer_durable_loan')),
  emi_amount numeric(12, 2) not null check (emi_amount >= 0),
  due_date date not null,
  overdue_amount numeric(12, 2) not null check (overdue_amount >= 0),
  days_past_due integer not null check (days_past_due >= 0),
  late_fee numeric(12, 2) not null default 0 check (late_fee >= 0)
);
create index loans_customer_id_idx on public.loans (customer_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id),
  amount numeric(12, 2) not null check (amount > 0),
  paid_at timestamptz not null,
  source text not null default 'demo_toggle'
);
create index payments_loan_id_idx on public.payments (loan_id);

-- Calls and audit trail -----------------------------------------------------------------------
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  use_case text not null default 'collections',
  customer_id uuid not null references public.customers (id),
  vapi_call_id text unique,
  language text not null check (language in ('en', 'hi')),
  verified boolean not null default false,
  verify_attempts integer not null default 0,
  attempt_no integer not null default 1,
  transcript text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index calls_customer_id_idx on public.calls (customer_id, started_at desc);

create table public.tool_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls (id),
  tool text not null,
  args jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index tool_events_call_id_idx on public.tool_events (call_id, created_at);

create table public.call_results (
  call_id uuid primary key references public.calls (id),
  summary jsonb,
  compliance jsonb,
  created_at timestamptz not null default now()
);

-- Follow-up agent ------------------------------------------------------------------------------
create table public.followup_runs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references public.calls (id),
  customer_id uuid not null references public.customers (id),
  path text not null check (path in ('rule', 'agent')),
  decision text not null,
  reasoning text not null,
  actions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.followups (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  scheduled_for timestamptz not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  created_at timestamptz not null default now()
);
create index followups_due_idx on public.followups (status, scheduled_for);

create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  call_id uuid references public.calls (id),
  note text not null,
  created_by text not null default 'followup-agent',
  created_at timestamptz not null default now()
);
create index customer_notes_customer_idx on public.customer_notes (customer_id, created_at desc);

create table public.promises (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls (id),
  loan_id uuid not null references public.loans (id),
  amount numeric(12, 2) not null check (amount > 0),
  promise_date date not null,
  payment_mode text not null check (payment_mode in ('upi', 'net_banking', 'debit_card', 'branch')),
  status text not null default 'pending' check (status in ('pending', 'kept', 'broken')),
  created_at timestamptz not null default now()
);
create index promises_loan_idx on public.promises (loan_id, promise_date desc);

create table public.handoffs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references public.calls (id),
  customer_id uuid not null references public.customers (id),
  reason text not null,
  summary text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

-- Knowledge base (RAG) ---------------------------------------------------------------------------
create table public.policy_chunks (
  id uuid primary key default gen_random_uuid(),
  doc_set text not null,
  doc text not null,
  section text not null,
  content text not null,
  embedding extensions.vector(768)
);

-- Evals and release gate -------------------------------------------------------------------------
create table public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  target text not null,
  prompt_hash text not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.eval_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.eval_runs (id),
  scenario_id text not null,
  run_no integer not null default 1,
  scores jsonb not null,
  transcript text not null,
  pass boolean not null
);
create index eval_results_run_idx on public.eval_results (run_id);

create table public.publishes (
  id uuid primary key default gen_random_uuid(),
  use_case text not null,
  prompt_hash text not null,
  eval_run_id uuid not null references public.eval_runs (id),
  published_at timestamptz not null default now()
);

-- Demo controls ----------------------------------------------------------------------------------
create table public.demo_settings (
  id integer primary key default 1 check (id = 1),
  demo_clock timestamptz
);
