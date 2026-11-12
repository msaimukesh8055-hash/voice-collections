-- supabase/migrations/20261112000001_calls_paused.sql
-- M9 Build B: the pause switch. When on, no new reminder call starts (live or simulated); calls
-- already in progress finish. Checked in code with the other pre-call rules (compliance/precall).
-- Additive: one column, default off, so behaviour is unchanged until the owner sends /pause.

alter table public.demo_settings
  add column calls_paused boolean not null default false;

comment on column public.demo_settings.calls_paused is
  'M9 pause switch: true = no new reminder call starts until the owner sends /resume.';
