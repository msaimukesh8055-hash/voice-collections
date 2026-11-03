-- supabase/migrations/20261104000001_whatsapp.sql
-- M4 WhatsApp core (ADR-0015): message log for "handle once" and the owner's confirmation cards.
-- Additive only. The owner's real number is never stored: senders are kept as a keyed hash
-- (M4 Decision 6). No message text is stored either (names and amounts stay in the ledger).

create table public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  -- Meta's message id ("wamid…"). Unique, so a retried webhook is handled once (Decision 9).
  wa_message_id text unique,
  direction text not null check (direction in ('in', 'out')),
  sender_hash text not null,
  msg_type text not null,
  -- How an incoming message was answered, measured by M7's evals.
  path text check (path in ('button', 'command', 'sarvam', 'gemini', 'failed', 'stranger')),
  command text,
  -- India date, for the "one not-registered reply per number per day" rule.
  ist_day date not null,
  created_at timestamptz not null default now()
);
create index wa_messages_created_idx on public.wa_messages (created_at desc);
-- A stranger gets at most one "not registered" reply a day: the database enforces it.
create unique index wa_messages_one_stranger_reply_a_day on public.wa_messages (sender_hash, ist_day)
  where direction = 'out' and path = 'stranger';

create table public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  -- entry = Save card; pick = choose a shopkeeper from a list; new_shopkeeper = "add X?".
  kind text not null check (kind in ('entry', 'pick', 'new_shopkeeper')),
  payload jsonb not null,
  -- 'done' closes a pick or new-shopkeeper step once it has led to the next card.
  status text not null default 'open'
    check (status in ('open', 'saved', 'cancelled', 'expired', 'done')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index pending_actions_owner_idx on public.pending_actions (owner_id, created_at desc);

alter table public.wa_messages enable row level security;
alter table public.pending_actions enable row level security;
