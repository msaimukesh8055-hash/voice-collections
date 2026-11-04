-- supabase/migrations/20261107000001_english_under_telugu.sql
-- M6 Decision 5: "English under Telugu", a demo setting on the owner. When on, every Telugu
-- WhatsApp message from the bot is followed by a blank line and its English translation (Sarvam
-- Translate, names and amounts protected), so a pitch audience can follow. Off by default for any
-- new owner; on for the one fake demo owner (Srinivas Reddy, played by Saim). Additive only.
alter table public.owners
  add column english_under_telugu boolean not null default false;

comment on column public.owners.english_under_telugu is
  'Demo setting (M6): follow each Telugu bot message with its English translation.';

-- The prototype has one owner, the fake demo persona: switch the setting on for him.
update public.owners set english_under_telugu = true;
