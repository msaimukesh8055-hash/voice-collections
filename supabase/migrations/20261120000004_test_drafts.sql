-- supabase/migrations/20261120000004_test_drafts.sql
-- Live failures to tests (Saim, 2026-11-20): a call or WhatsApp message that went wrong, saved
-- from its page with "Add as a test case". Each draft is turned into a scripted test by hand and
-- approved by Saim before it joins the release gate. One draft per call or message. WhatsApp
-- message text is never stored by the bot, so for a message the owner types what he sent.
-- Fake data only. Service role only. Additive.
create table public.test_drafts (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('asha_call', 'munshi_call', 'whatsapp')),
  -- The call id, or the WhatsApp request's trace id.
  ref_id text not null,
  said text not null check (length(said) <= 1000),
  problem text not null check (length(problem) <= 1000),
  expected text check (length(expected) <= 500),
  status text not null default 'waiting' check (status in ('waiting', 'added', 'dropped')),
  created_at timestamptz not null default now(),
  unique (source, ref_id)
);
create index test_drafts_created_idx on public.test_drafts (created_at desc);

alter table public.test_drafts enable row level security;
