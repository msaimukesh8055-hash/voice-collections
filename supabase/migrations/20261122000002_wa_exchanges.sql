-- supabase/migrations/20261122000002_wa_exchanges.sql
-- WhatsApp live checks (Saim, 2026-11-22; ADR-0022). One row per owner message: what he wrote (or
-- what Saaras heard, or the button he tapped), the bot's reply, how it was understood, the card it
-- showed or answered, ledger changes made, reply time and whether Meta took every reply.
-- This changes M4 Decision 6 / ADR-0015 ("no message text stored") for these rows only: the text
-- is kept for 30 days, then deleted by the daily job below. Phone numbers are never stored; the
-- sender is the owner by construction (strangers never get a row). Service role only. Additive.
create table public.wa_exchanges (
  id uuid primary key default gen_random_uuid(),
  -- Removing the message row (the smoke script's clean-up) removes its exchange too.
  wa_message_id text not null unique
    references public.wa_messages (wa_message_id) on delete cascade,
  msg_type text not null,
  path text not null check (path in ('button', 'command', 'sarvam', 'gemini', 'failed', 'stranger')),
  command text,
  in_text text check (char_length(in_text) <= 2000),
  reply_text text check (char_length(reply_text) <= 2000),
  language text,
  replies_sent integer not null default 0 check (replies_sent >= 0),
  replies_failed integer not null default 0 check (replies_failed >= 0),
  voice_reply boolean not null default false,
  card_action_id uuid,
  answers_action_id uuid,
  money_writes integer not null default 0 check (money_writes >= 0),
  error_code text,
  handle_ms integer not null check (handle_ms >= 0),
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
create index wa_exchanges_created_idx on public.wa_exchanges (created_at desc);

comment on table public.wa_exchanges is
  'ADR-0022: one owner WhatsApp message and the bot''s answer, for the WhatsApp live checks. Text kept 30 days.';

alter table public.wa_exchanges enable row level security;

-- 30 days, then gone (Saim's decision, 2026-11-22). Runs daily at 01:50 India time.
select cron.schedule('wa-exchanges-retention', '20 20 * * *',
  $$delete from public.wa_exchanges where created_at < now() - interval '30 days'$$);
