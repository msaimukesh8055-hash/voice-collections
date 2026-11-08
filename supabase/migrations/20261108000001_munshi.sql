-- supabase/migrations/20261108000001_munshi.sql
-- M8 (ADR-0018 with its 2026-11-07 amendments): Munshi, the owner's call line. Additive only; no
-- existing row is rewritten. Build A uses owner_calls and owner_tool_events; the rest (voice
-- actions on pending_actions, the reversal status, ledger_reversals and reverse_ledger_entry) is
-- here too so M8 has one migration, and is used from Build B.

-- One owner call per WhatsApp "Call Munshi" tap: a single-use link (issued, 15 minutes), used up
-- by Start call on the /munshi page (accepted), one Sarvam session (in_progress), then ended.
create table public.owner_calls (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  status text not null default 'issued'
    check (status in ('issued', 'accepted', 'in_progress', 'completed', 'expired')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  url_issued_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds >= 0),
  interaction_id text
);
create index owner_calls_owner_idx on public.owner_calls (owner_id, issued_at desc);
-- The daily live-session cap counts issued Sarvam URLs (with calls.url_issued_at).
create index owner_calls_url_issued_idx on public.owner_calls (url_issued_at)
  where url_issued_at is not null;
alter table public.owner_calls enable row level security;

-- Munshi's audit trail: one row per tool call, refusals included (like tool_events for Asha).
create table public.owner_tool_events (
  id uuid primary key default gen_random_uuid(),
  owner_call_id uuid not null references public.owner_calls (id) on delete cascade,
  tool text not null,
  args jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index owner_tool_events_call_idx on public.owner_tool_events (owner_call_id, created_at);
alter table public.owner_tool_events enable row level security;

-- Build B: a spoken change is a pending action tied to the owner call (read back, then yes).
alter table public.pending_actions
  add column owner_call_id uuid references public.owner_calls (id) on delete cascade;
alter table public.pending_actions drop constraint pending_actions_kind_check;
alter table public.pending_actions add constraint pending_actions_kind_check
  check (kind in (
    'entry', 'pick', 'new_shopkeeper', 'remind_all',
    'voice_credit', 'voice_payment', 'voice_delete', 'voice_remind', 'voice_claim', 'voice_send'
  ));
alter table public.pending_actions add constraint pending_actions_voice_has_call
  check ((kind like 'voice\_%') = (owner_call_id is not null));
create index pending_actions_owner_call_idx on public.pending_actions (owner_call_id, created_at desc)
  where owner_call_id is not null;

-- Delete by voice = reversal (Decision 2b): the entry's status becomes 'reversed', never removed.
-- Every reader already counts only 'confirmed', so dues, insights, score and balances are unchanged.
alter table public.ledger_entries drop constraint ledger_entries_status_check;
alter table public.ledger_entries add constraint ledger_entries_status_check
  check (status in ('confirmed', 'claimed', 'rejected', 'reversed'));
alter table public.ledger_entries drop constraint ledger_credit_is_confirmed;
alter table public.ledger_entries add constraint ledger_credit_is_confirmed
  check (kind = 'payment' or status in ('confirmed', 'reversed'));
alter table public.ledger_entries drop constraint ledger_entries_source_check;
alter table public.ledger_entries add constraint ledger_entries_source_check
  check (source in ('seed', 'text', 'voice', 'call', 'web', 'munshi'));

-- Who reversed which entry, when, on which owner call. Unique: an entry is reversed once.
create table public.ledger_reversals (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null unique references public.ledger_entries (id),
  owner_call_id uuid not null references public.owner_calls (id),
  created_at timestamptz not null default now()
);
alter table public.ledger_reversals enable row level security;

-- One round trip, atomic: confirmed → reversed (compare-and-set) and the reversal row. False when
-- the entry was not confirmed (already reversed, claimed, rejected or unknown).
create function public.reverse_ledger_entry(entry_id uuid, owner_call_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  reversed_id uuid;
begin
  update public.ledger_entries
     set status = 'reversed'
   where id = reverse_ledger_entry.entry_id
     and status = 'confirmed'
  returning id into reversed_id;
  if reversed_id is null then
    return false;
  end if;
  insert into public.ledger_reversals (entry_id, owner_call_id)
  values (reversed_id, reverse_ledger_entry.owner_call_id);
  return true;
end;
$$;

-- Functions in public are callable with the anon key unless revoked: only the service role.
revoke execute on function public.reverse_ledger_entry(uuid, uuid)
  from public, anon, authenticated;

comment on table public.owner_calls is
  'M8 Munshi: one single-use owner call link per "Call Munshi" tap (ADR-0018).';
comment on table public.ledger_reversals is
  'M8 Munshi: a confirmed entry reversed by voice (status reversed), never deleted.';
