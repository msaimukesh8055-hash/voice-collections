-- supabase/migrations/20261107000002_transcript_english.sql
-- M6 Decision 4 (Saim, 2026-11-04): the dashboard shows an English version under each Telugu or
-- Hindi line of a call's transcript (Sarvam Translate, names and amounts protected). It is made
-- once, the first time the call is opened, and kept here so it is never paid for twice. One entry
-- per transcript turn, in order: the English text, or null when the line needed none (already
-- English) or could not be translated. Additive only.
alter table public.calls
  add column transcript_en jsonb;

comment on column public.calls.transcript_en is
  'English of each transcript turn (M6 dashboard), null entries for lines left as they were.';
