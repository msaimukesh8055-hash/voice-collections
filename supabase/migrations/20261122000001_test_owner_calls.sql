-- supabase/migrations/20261122000001_test_owner_calls.sql
-- Test calls are flagged, not guessed (Saim, 2026-11-22). The Munshi latency smoke script opens an
-- owner call on the real book with no voice and no conversation; it was being scored like a real
-- call and showed in Agent health (2 "good", 1 "failed"). Additive only.
alter table public.owner_calls
  add column is_test boolean not null default false;

comment on column public.owner_calls.is_test is
  'true = opened by a test script (npm run smoke:munshi-latency), not by the owner. Shown with a "Test call" tag on Munshi calls; left out of Agent health.';

-- The three script calls made before this flag existed: no Sarvam call, no transcript, tool calls
-- only (checked by hand on 2026-11-22).
update public.owner_calls set is_test = true
where id in (
  '16d5a076-8851-4755-b6d7-3edcbd36868d',
  '6ce6f98c-fba4-4992-a93f-9626a9c502d0',
  'ff97bb6c-b614-4f0e-bec4-9bd2fcc75680'
) and interaction_id is null;
