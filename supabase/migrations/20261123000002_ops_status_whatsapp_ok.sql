-- supabase/migrations/20261123000002_ops_status_whatsapp_ok.sql
-- Ops redesign follow-up: Meta WhatsApp needs the time a reply last went through, so one old
-- send failure reads as "recovered" once replies are going out again, not "failing" for 7 days.
-- Same function as 20261123000001 with one added field (whatsapp.last_ok_at). Additive only.

create or replace function public.ops_status()
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
      'last_ok_at', max(x.created_at) filter (where x.replies_sent > 0),
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
