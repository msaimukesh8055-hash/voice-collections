-- supabase/migrations/20261103000001_easy_recovery_schema.sql
-- Easy Recovery AI schema (SPEC v2.0 §13, M3 Decision 6 (a)). Replaces the Suvidha loan tables.
-- On the Mumbai project these drops run on empty tables (the older migrations create them first);
-- the M2 test history stays in the paused Oregon project. Fake data only.

drop table if exists
  public.publishes, public.eval_results, public.eval_runs, public.policy_chunks,
  public.handoffs, public.promises, public.customer_notes, public.followups,
  public.followup_runs, public.call_results, public.tool_events, public.calls,
  public.payments, public.loans, public.customers, public.demo_settings
  cascade;

-- Owner and shopkeepers ----------------------------------------------------------------------------
create table public.owners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_name text not null,
  city text not null,
  language text not null check (language in ('te', 'hi', 'en')),
  -- Saim's real WhatsApp number comes from .env in M4; never seeded.
  whatsapp_number text,
  alert_time time not null default '09:00',
  -- Shown at tone level 3 only when the owner set one (SPEC §7.4).
  consequence_text text,
  created_at timestamptz not null default now()
);

create table public.shopkeepers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id),
  name text not null,
  shop_name text not null,
  area text not null,
  phone text not null,
  language text not null check (language in ('te', 'hi', 'en')),
  -- Persona the simulated borrower plays in M5 (SPEC §7.7).
  persona text,
  do_not_call boolean not null default false,
  -- Reliability score (SPEC §9), filled in M5.
  score integer check (score between 0 and 100),
  score_band text check (score_band in ('reliable', 'watch', 'risky', 'new')),
  score_parts jsonb,
  score_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, shop_name)
);
create index shopkeepers_owner_idx on public.shopkeepers (owner_id);

-- Calls (the id is the one-time call token, ADR-0009) -----------------------------------------------
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  shopkeeper_id uuid not null references public.shopkeepers (id),
  mode text not null default 'live' check (mode in ('live', 'simulated')),
  status text not null default 'queued' check (
    status in ('queued', 'ringing', 'accepted', 'in_progress', 'completed', 'declined', 'missed')
  ),
  language text not null check (language in ('te', 'hi', 'en')),
  -- Sarvam interaction id (YYYYMMDD/<id>), reported by the phone page at hang-up.
  interaction_id text unique,
  identity_status text not null default 'unknown'
    check (identity_status in ('unknown', 'confirmed', 'denied')),
  identity_unsure_count integer not null default 0 check (identity_unsure_count >= 0),
  tone_level integer not null default 1 check (tone_level between 1 and 3),
  transcript jsonb,
  summary text,
  cost_inr numeric(8, 2),
  queued_at timestamptz not null default now(),
  ringing_at timestamptz,
  accepted_at timestamptz,
  -- Set once, when our proxy hands out the Sarvam call URL: one URL per token (M3 Decision 4).
  url_issued_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds >= 0)
);
create index calls_shopkeeper_idx on public.calls (shopkeeper_id, queued_at desc);
create index calls_status_idx on public.calls (status, queued_at desc);

-- Credit book ----------------------------------------------------------------------------------------
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  shopkeeper_id uuid not null references public.shopkeepers (id),
  kind text not null check (kind in ('credit', 'payment')),
  amount numeric(12, 2) not null check (amount > 0),
  -- Day the credit was given or the payment was made (India date).
  entry_date date not null,
  due_date date,
  -- Only the owner confirms money: a payment Asha hears about is 'claimed' and never counts.
  status text not null default 'confirmed' check (status in ('confirmed', 'claimed', 'rejected')),
  source text not null check (source in ('seed', 'text', 'voice', 'call', 'web')),
  payment_mode text check (payment_mode in ('cash', 'upi', 'bank_transfer', 'cheque')),
  call_id uuid references public.calls (id),
  note text,
  created_at timestamptz not null default now(),
  constraint ledger_credit_has_due_date check ((kind = 'credit') = (due_date is not null)),
  constraint ledger_credit_is_confirmed check (kind = 'payment' or status = 'confirmed')
);
create index ledger_entries_shopkeeper_idx on public.ledger_entries (shopkeeper_id, entry_date);
-- One payment claim per call: two simultaneous tool calls cannot both save one.
create unique index ledger_entries_one_per_call on public.ledger_entries (call_id)
  where call_id is not null;

create table public.promises (
  id uuid primary key default gen_random_uuid(),
  shopkeeper_id uuid not null references public.shopkeepers (id),
  call_id uuid references public.calls (id),
  amount numeric(12, 2) not null check (amount > 0),
  promise_date date not null,
  status text not null default 'open' check (status in ('open', 'kept', 'broken', 'replaced')),
  created_at timestamptz not null default now()
);
create index promises_shopkeeper_idx on public.promises (shopkeeper_id, created_at desc);
-- At most one promise per call (M3 Decision 6): the database backs up the tool's check.
create unique index promises_one_per_call on public.promises (call_id) where call_id is not null;

-- A new promise replaces the shopkeeper's older open one, so there is only ever one to check.
create function public.replace_open_promises() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.promises
     set status = 'replaced'
   where shopkeeper_id = new.shopkeeper_id
     and status = 'open'
     and id <> new.id;
  return new;
end;
$$;

create trigger promises_replace_open
  after insert on public.promises
  for each row when (new.status = 'open')
  execute function public.replace_open_promises();

-- Outstanding per shopkeeper (confirmed entries only). Overdue amounts and days are worked out in
-- code, because a view cannot see the demo clock. security_invoker: the caller's RLS applies.
create view public.balances with (security_invoker = true) as
select
  s.id as shopkeeper_id,
  coalesce(sum(case when e.kind = 'credit' then e.amount else -e.amount end)
    filter (where e.status = 'confirmed'), 0) as outstanding
from public.shopkeepers s
left join public.ledger_entries e on e.shopkeeper_id = s.id
group by s.id;

-- Audit trail --------------------------------------------------------------------------------------
create table public.tool_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls (id),
  tool text not null,
  args jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index tool_events_call_idx on public.tool_events (call_id, created_at);

-- Follow-up agent (M5) -----------------------------------------------------------------------------
create table public.shopkeeper_notes (
  id uuid primary key default gen_random_uuid(),
  shopkeeper_id uuid not null references public.shopkeepers (id),
  call_id uuid references public.calls (id),
  note text not null,
  created_by text not null default 'followup-agent',
  created_at timestamptz not null default now()
);
create index shopkeeper_notes_idx on public.shopkeeper_notes (shopkeeper_id, created_at desc);

create table public.followup_runs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references public.calls (id),
  shopkeeper_id uuid not null references public.shopkeepers (id),
  path text not null check (path in ('rule', 'agent')),
  decision text not null,
  reasoning text not null,
  actions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.followups (
  id uuid primary key default gen_random_uuid(),
  shopkeeper_id uuid not null references public.shopkeepers (id),
  call_id uuid references public.calls (id),
  kind text not null check (kind in ('owner_callback', 'promise_check', 'remind_again', 'claim_confirm')),
  reason text not null,
  summary text,
  scheduled_for timestamptz,
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  created_at timestamptz not null default now()
);
create index followups_due_idx on public.followups (status, scheduled_for);

-- Evals and Asha versions ----------------------------------------------------------------------------
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
  agent text not null,
  prompt_hash text not null,
  sarvam_app_id text not null,
  sarvam_version integer not null check (sarvam_version > 0),
  -- Required by the release gate from M7; optional until then.
  eval_run_id uuid references public.eval_runs (id),
  published_at timestamptz not null default now(),
  unique (sarvam_app_id, sarvam_version)
);

-- Demo controls ----------------------------------------------------------------------------------
create table public.demo_settings (
  id integer primary key default 1 check (id = 1),
  demo_clock timestamptz,
  calling_hours_enabled boolean not null default false,
  call_limits_enabled boolean not null default false,
  -- The shopkeeper Saim plays on the phone page; every other shopkeeper gets simulated calls.
  live_shopkeeper_id uuid references public.shopkeepers (id)
);
