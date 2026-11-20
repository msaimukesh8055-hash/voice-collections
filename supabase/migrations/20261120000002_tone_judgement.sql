-- supabase/migrations/20261120000002_tone_judgement.sql
-- Live evals (2026-11-20): the AI tone judge's scores for one call, made the first time its
-- report opens and kept, so it is judged once. Asha's calls and Munshi's owner calls. Additive only.
alter table public.calls add column tone_judgement jsonb;
alter table public.owner_calls add column tone_judgement jsonb;
