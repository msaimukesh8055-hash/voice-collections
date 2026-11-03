-- supabase/migrations/20261105000001_followup.sql
-- M5 half 5a (ADR-0016): the follow-up worker's queue on calls, plus the "do it once" guarantees.
-- Additive only: new nullable or defaulted columns, new partial indexes, one widened check.

-- Queue state on each call. calls-api sets followup_status = 'pending' when a call ends
-- (completed, declined or missed); the worker claims it (compare-and-set on status + attempts),
-- then marks it done or failed. followup_next_at lets the worker retry while Sarvam's
-- transcript lags; followup_claimed_at lets a sweep take back a claim whose worker died.
alter table public.calls
  add column followup_status text
    check (followup_status in ('pending', 'running', 'done', 'failed')),
  add column followup_attempts integer not null default 0 check (followup_attempts >= 0),
  add column followup_next_at timestamptz,
  add column followup_claimed_at timestamptz;

-- The sweep reads "pending and due" and "running but stale": only calls in the queue are indexed.
create index calls_followup_due_idx on public.calls (followup_status, followup_next_at)
  where followup_status in ('pending', 'running');

-- One follow-up decision per call: the insert of this row is the worker's commit point, so a
-- retried or duplicated job can never act twice.
create unique index followup_runs_one_per_call on public.followup_runs (call_id)
  where call_id is not null;

-- One note per call (Asha reads the newest at the next call).
create unique index shopkeeper_notes_one_per_call on public.shopkeeper_notes (call_id)
  where call_id is not null;

-- "Stop reminding" (shopkeeper is angry or disputes the amount) becomes a pause_reminders
-- follow-up; 5b's reminder queue skips shopkeepers with an open one.
alter table public.followups drop constraint followups_kind_check;
alter table public.followups add constraint followups_kind_check
  check (kind in ('owner_callback', 'promise_check', 'remind_again', 'claim_confirm',
    'pause_reminders'));
