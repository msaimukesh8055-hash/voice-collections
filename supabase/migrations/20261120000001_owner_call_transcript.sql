-- supabase/migrations/20261120000001_owner_call_transcript.sql
-- Live evals for Munshi (2026-11-20): an owner call keeps its transcript (fetched from Sarvam the
-- first time its report page opens) and the transcript's English, like calls.transcript and
-- calls.transcript_en for Asha. Additive only.
alter table public.owner_calls add column transcript jsonb;
alter table public.owner_calls add column transcript_en jsonb;
