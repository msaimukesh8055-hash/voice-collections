-- supabase/migrations/20261123000001_ops_status.sql
-- Ops page redesign (Saim, 2026-11-23): is the product up, is it meeting its targets, are the
-- services it depends on and its scheduled jobs working, and which errors keep coming back.
--   health_checks: one row per health probe. Every 5 minutes pg_cron asks the follow-up worker
--     to call the app API's /v1/health (which reads the database) and write what came back. A
--     missing row counts as down on the ops page, so a dead worker or timer is never "up".
--     History starts with the first probe; the page says "measured since" that date.
--   ops_status(): the numbers behind the new sections, from raw rows (counts only; no names,
--     phone numbers or amounts). Service role only. Additive only.

create table public.health_checks (
  id uuid primary key default gen_random_uuid(),
  checked_at timestamptz not null default now(),
  -- True when /v1/health answered 200 (the API is up and it reached the database).
  ok boolean not null,
  -- HTTP status, or null when no answer came back (timeout, network).
  status_code integer,
  duration_ms integer not null check (duration_ms >= 0),
  -- The database check inside /v1/health: 'ok', 'fail', or null when there was no answer.
  database text check (database in ('ok', 'fail')),
  -- The deployed commit /v1/health reported.
  version text check (char_length(version) <= 100),
  -- A short code when there was no answer (e.g. TimeoutError); never a message body.
  error_code text check (char_length(error_code) <= 100)
);
create index health_checks_checked_idx on public.health_checks (checked_at desc);
alter table public.health_checks enable row level security;

comment on table public.health_checks is
  'One health probe of the app API every 5 minutes (pg_cron → followup-worker /health-probe).';

-- Every 5 minutes, two minutes after ops-watch so the two never start together.
select cron.schedule('health-probe', '2-59/5 * * * *',
  $$select public.call_followup_worker('/health-probe')$$);

-- 90 days is enough for "uptime since" and stays tiny (288 rows a day).
select cron.schedule('health-checks-retention', '30 20 * * *',
  $$delete from public.health_checks where checked_at < now() - interval '90 days'$$);

create function public.ops_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  bounds as (
    select now() - interval '24 hours' as day_ago, now() - interval '7 days' as week_ago
  ),
  probes as (
    select jsonb_build_object(
      'first_at', min(checked_at),
      'day_total', count(*) filter (where checked_at >= b.day_ago),
      'day_ok', count(*) filter (where checked_at >= b.day_ago and ok),
      'week_total', count(*) filter (where checked_at >= b.week_ago),
      'week_ok', count(*) filter (where checked_at >= b.week_ago and ok),
      'all_total', count(*),
      'all_ok', count(*) filter (where ok),
      'week_p95_ms', round(percentile_cont(0.95) within group (order by duration_ms)
        filter (where checked_at >= b.week_ago))::int
    ) as value from public.health_checks, bounds b
  ),
  last_probe as (
    select coalesce((
      select jsonb_build_object('checked_at', checked_at, 'ok', ok, 'status_code', status_code,
        'duration_ms', duration_ms, 'database', database, 'version', version,
        'error_code', error_code)
        from public.health_checks order by checked_at desc limit 1), 'null'::jsonb) as value
  ),
  -- Eval traffic (detail.eval) is left out, as on the rest of the ops page.
  recent as (
    select e.* from public.ops_events e, bounds b
     where e.created_at >= b.week_ago and not (e.detail ? 'eval')
  ),
  -- Timers reach the worker as requests; their route says which job it was.
  job_requests as (
    select coalesce(jsonb_agg(to_jsonb(j) order by j.route), '[]'::jsonb) as value from (
      select r.detail->>'route' as route,
             count(*) filter (where r.created_at >= b.day_ago) as day_runs,
             count(*) filter (where r.created_at >= b.day_ago and r.status <> 'ok') as day_failed,
             count(*) as week_runs,
             max(r.created_at) as last_at
        from recent r, bounds b
       where r.source = 'followup-worker' and r.step = 'request'
         and r.detail->>'route' in ('/sweep', '/ops-watch', '/daily-alert', '/promise-check',
                                    '/health-probe')
       group by r.detail->>'route'
    ) j
  ),
  -- What pg_cron itself recorded: the schedule, and whether each job's SQL ran.
  jobs as (
    select coalesce(jsonb_agg(to_jsonb(c) order by c.name), '[]'::jsonb) as value from (
      select j.jobname as name, j.schedule, j.active,
             (select max(d.start_time) from cron.job_run_details d where d.jobid = j.jobid)
               as last_run_at,
             (select d.status from cron.job_run_details d where d.jobid = j.jobid
               order by d.start_time desc limit 1) as last_status,
             (select count(*) from cron.job_run_details d, bounds b
               where d.jobid = j.jobid and d.start_time >= b.day_ago) as day_runs,
             (select count(*) from cron.job_run_details d, bounds b
               where d.jobid = j.jobid and d.start_time >= b.day_ago and d.status = 'failed')
               as day_failed
        from cron.job j
    ) c
  ),
  error_groups as (
    select coalesce(jsonb_agg(to_jsonb(g) order by g.last_at desc), '[]'::jsonb) as value from (
      select source, step, error_code, count(*) as count, max(created_at) as last_at,
             (array_agg(trace_id order by created_at desc))[1] as trace_id
        from recent where status = 'error'
       group by source, step, error_code
    ) g
  ),
  -- Outside services, as our own calls to them saw it. LLM answers that were only badly shaped
  -- (bad_json) still reached the provider, so they are not counted as the provider failing.
  providers as (
    select coalesce(jsonb_agg(to_jsonb(p) order by p.provider), '[]'::jsonb) as value from (
      select provider, count(*) as calls,
             count(*) filter (where status <> 'ok' and error_code is distinct from 'bad_json')
               as failed,
             max(created_at) filter (where status = 'ok') as last_ok_at,
             max(created_at) filter (where status <> 'ok'
               and error_code is distinct from 'bad_json') as last_failed_at
        from recent
       where provider is not null and step <> 'llm_usage'
       group by provider
    ) p
  ),
  -- Sarvam voice: each web call starts with our API asking Sarvam for a call link.
  voice as (
    select jsonb_build_object(
      'calls', count(*),
      'failed', count(*) filter (where status = 'error'),
      'last_ok_at', max(created_at) filter (where status = 'ok'),
      'last_failed_at', max(created_at) filter (where status = 'error')
    ) as value from recent
     where source = 'calls-api' and step = 'request' and detail->>'route' like '/v1/sarvam/%'
  ),
  -- Meta WhatsApp: the bot's replies to the owner (each exchange records sent and failed), and
  -- every send failure logged anywhere (alerts and summaries too).
  whatsapp as (
    select jsonb_build_object(
      'replies_sent', coalesce(sum(x.replies_sent), 0),
      'replies_failed', coalesce(sum(x.replies_failed), 0),
      'send_failures', (select count(*) from recent where step = 'whatsapp_send_failed'),
      'last_failed_at', (select max(created_at) from recent where step = 'whatsapp_send_failed')
    ) as value from public.wa_exchanges x, bounds b
     where x.created_at >= b.week_ago and not x.is_test
  ),
  wa_reply as (
    select jsonb_build_object(
      'messages', count(*),
      'p50_ms', round(percentile_cont(0.5) within group (order by handle_ms))::int,
      'p95_ms', round(percentile_cont(0.95) within group (order by handle_ms))::int
    ) as value from public.wa_exchanges x, bounds b
     where x.created_at >= b.week_ago and not x.is_test
  )
  select jsonb_build_object(
    'probes', (select value from probes),
    'last_probe', (select value from last_probe),
    'job_requests', (select value from job_requests),
    'jobs', (select value from jobs),
    'error_groups', (select value from error_groups),
    'providers', (select value from providers),
    'voice', (select value from voice),
    'whatsapp', (select value from whatsapp),
    'wa_reply', (select value from wa_reply));
$$;
revoke execute on function public.ops_status() from public, anon, authenticated;
grant execute on function public.ops_status() to service_role;
