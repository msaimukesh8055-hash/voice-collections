-- supabase/migrations/20261106000001_reminders.sql
-- M5 half 5b: due alert, Remind / Remind all, simulated calls, and the pg_cron scheduler.
-- Additive only. Needs two Vault secrets before the cron jobs can call the worker, set once in the
-- Supabase SQL editor (README "Scheduler"), never in this file: followup_worker_url and
-- worker_secret.

-- "Call 7 people?" [Yes] [No] is a card like the Save card; it holds who will be called.
alter table public.pending_actions drop constraint pending_actions_kind_check;
alter table public.pending_actions add constraint pending_actions_kind_check
  check (kind in ('entry', 'pick', 'new_shopkeeper', 'remind_all'));

-- One daily alert per owner per demo day: a retried cron call never sends twice (Decision 7).
create table public.owner_alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  -- India date on the demo clock.
  alert_day date not null,
  -- full = alert with Remind buttons (inside WhatsApp's 24-hour window); template = the approved
  -- "N shopkeepers are due today. Reply DUE" message (outside it).
  kind text not null check (kind in ('full', 'template')),
  created_at timestamptz not null default now(),
  unique (owner_id, alert_day)
);
alter table public.owner_alerts enable row level security;

-- Simulated calls waiting for a slot are read oldest first.
create index calls_simulated_queue_idx on public.calls (status, queued_at)
  where mode = 'simulated' and status in ('queued', 'in_progress');

-- At most `max_running` simulated calls at once (Sarvam's limit, SPEC §6.5). The lock makes the
-- count-then-claim atomic, so two workers can never both start the fifth call. A call in progress
-- since before `stale_before` lost its run and does not hold a slot.
create function public.claim_simulated_call(max_running integer, stale_before timestamptz)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  running integer;
  claimed uuid;
begin
  perform pg_advisory_xact_lock(hashtext('claim_simulated_call'));
  select count(*) into running
    from public.calls
   where mode = 'simulated' and status = 'in_progress' and accepted_at >= stale_before;
  if running >= max_running then
    return null;
  end if;
  update public.calls
     set status = 'in_progress', accepted_at = now()
   where id = (
     select id from public.calls
      where mode = 'simulated' and status = 'queued'
      order by queued_at
      limit 1
      for update skip locked
   )
  returning id into claimed;
  return claimed;
end;
$$;
-- Functions in public are callable by anyone with the anon key unless revoked: only the worker
-- (service role) may claim calls.
revoke execute on function public.claim_simulated_call(integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_simulated_call(integer, timestamptz) to service_role;

-- Scheduler (pg_cron + pg_net, both on the free plan) ------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Posts one worker path with WORKER_SECRET as a bearer token. The URL and the secret live in
-- Supabase Vault (never in a migration or a cron command). Missing secrets → a warning, no call.
create function public.call_followup_worker(route text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  secret text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets
   where name = 'followup_worker_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'worker_secret';
  if base_url is null or secret is null then
    raise warning 'call_followup_worker: vault secrets missing';
    return null;
  end if;
  return net.http_post(
    url := base_url || route,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret,
      'Content-Type', 'application/json'),
    timeout_milliseconds := 5000
  );
end;
$$;
revoke execute on function public.call_followup_worker(text) from public, anon, authenticated;

-- Times are UTC (pg_cron); India is UTC+5:30. Content always uses the demo-clock date.
--   every minute     sweep: due follow-ups (transcript retries, lost wake-ups), queued simulations
--   08:45 IST daily  promise check (kept/broken, scores)
--   09:00 IST daily  due alert to the owner (full alert or template, once per demo day)
select cron.schedule('followup-sweep', '* * * * *',
  $$select public.call_followup_worker('/sweep')$$);
select cron.schedule('daily-promise-check', '15 3 * * *',
  $$select public.call_followup_worker('/promise-check')$$);
select cron.schedule('daily-due-alert', '30 3 * * *',
  $$select public.call_followup_worker('/daily-alert')$$);
