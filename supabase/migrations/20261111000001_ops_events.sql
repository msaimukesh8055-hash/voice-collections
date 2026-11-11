-- supabase/migrations/20261111000001_ops_events.sql
-- M9 Build A: one row per step of a request, tied together by trace_id, so one WhatsApp message
-- or tool call can be followed from the first byte to the last database write, and the ops page
-- can show error rate, latency, rejected LLM answers and token spend. Additive only.
-- Rows hold what logs hold: ids, codes and timings. Never names, phone numbers, amounts, prompts
-- or answers (security.md).

create table public.ops_events (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null,
  -- The Edge Function that handled the request.
  source text not null,
  -- "request" for the request itself; otherwise the log event name (e.g. brain_llm).
  step text not null,
  status text not null check (status in ('ok', 'warn', 'error')),
  error_code text,
  -- LLM or speech provider, when the step called one.
  provider text,
  duration_ms integer check (duration_ms >= 0),
  tokens_in integer check (tokens_in >= 0),
  tokens_out integer check (tokens_out >= 0),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ops_events_created_idx on public.ops_events (created_at desc);
create index ops_events_trace_idx on public.ops_events (trace_id, created_at);
-- The alert job and the ops page's error list read only the failures.
create index ops_events_errors_idx on public.ops_events (created_at desc) where status = 'error';
alter table public.ops_events enable row level security;

-- Keep two weeks of steps: enough for the ops page's 7-day view and for looking into last week's
-- incident. Token-count rows (few, and no detail beyond counts) stay, so monthly spend is whole.
select cron.schedule('ops-events-retention', '10 20 * * *',
  $$delete from public.ops_events
     where created_at < now() - interval '14 days' and step <> 'llm_usage'$$);

-- The ops page's numbers in one call, worked out in the database so the page never pulls
-- thousands of rows. Counts, timings and codes only. "Failed" = a request whose trace has at
-- least one error step. Days are India days. Server-only: the functions call it with the
-- service role key.
create function public.ops_summary()
returns jsonb
language sql
stable
set search_path = ''
as $$
  with
  bounds as (
    select now() - interval '24 hours' as day_ago,
           now() - interval '7 days' as week_ago,
           (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
             as today_start,
           (date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
             as month_start
  ),
  recent as (
    select e.* from public.ops_events e, bounds b where e.created_at >= b.week_ago
  ),
  failed_traces as (
    select distinct trace_id from recent where status = 'error'
  ),
  requests as (
    select r.source, r.duration_ms, r.created_at, (f.trace_id is not null) as failed
      from recent r left join failed_traces f using (trace_id)
     where r.step = 'request'
  ),
  windows as (
    select jsonb_build_object(
      'day', jsonb_build_object(
        'requests', count(*) filter (where created_at >= b.day_ago),
        'failed', count(*) filter (where created_at >= b.day_ago and failed)),
      'week', jsonb_build_object(
        'requests', count(*),
        'failed', count(*) filter (where failed))) as value
      from requests, bounds b
  ),
  sources as (
    select coalesce(jsonb_agg(to_jsonb(s) order by s.source), '[]'::jsonb) as value from (
      select source, count(*) as requests, count(*) filter (where failed) as failed,
             round(percentile_cont(0.95) within group (order by duration_ms))::int as p95_ms
        from requests, bounds b where created_at >= b.day_ago group by source
    ) s
  ),
  tool_rows as (
    select 'asha' as agent, tool, duration_ms from public.tool_events t, bounds b
     where t.created_at >= b.week_ago and duration_ms is not null
    union all
    select 'munshi', tool, duration_ms from public.owner_tool_events t, bounds b
     where t.created_at >= b.week_ago and duration_ms is not null
  ),
  tools as (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.agent, t.tool), '[]'::jsonb) as value
      from (
        select agent, tool, count(*) as calls,
               round(percentile_cont(0.5) within group (order by duration_ms))::int as p50_ms,
               round(percentile_cont(0.95) within group (order by duration_ms))::int as p95_ms
          from tool_rows group by agent, tool
      ) t
  ),
  llm as (
    select coalesce(jsonb_agg(to_jsonb(l) order by l.provider), '[]'::jsonb) as value from (
      select provider,
             count(*) as answers,
             count(*) filter (where error_code = 'bad_json') as rejected,
             count(*) filter (where status <> 'ok' and error_code is distinct from 'bad_json')
               as failed
        from recent
       where provider is not null and step <> 'llm_usage' and detail ? 'outcome'
       group by provider
    ) l
  ),
  -- Token rows are kept past the two-week clean-up (below), so the month's spend stays whole.
  tokens as (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.provider), '[]'::jsonb) as value from (
      select provider,
             coalesce(sum(tokens_in) filter (where e.created_at >= b.today_start), 0)
               as today_in,
             coalesce(sum(tokens_out) filter (where e.created_at >= b.today_start), 0)
               as today_out,
             coalesce(sum(tokens_in), 0) as month_in,
             coalesce(sum(tokens_out), 0) as month_out
        from public.ops_events e, bounds b
       where e.step = 'llm_usage' and e.provider is not null and e.created_at >= b.month_start
       group by provider
    ) t
  ),
  paths as (
    select coalesce(jsonb_object_agg(path, total), '{}'::jsonb) as value from (
      select path, count(*) as total from public.wa_messages m, bounds b
       where m.direction = 'in' and m.path is not null and m.created_at >= b.week_ago
       group by path
    ) p
  ),
  followups as (
    select jsonb_build_object(
      'waiting', count(*) filter (where followup_status in ('pending', 'running')),
      'stuck', count(*) filter (where
        (followup_status = 'pending' and followup_next_at < now() - interval '10 minutes') or
        (followup_status = 'running' and followup_claimed_at < now() - interval '10 minutes')),
      'failed_week', count(*) filter (where followup_status = 'failed' and ended_at >= b.week_ago)
    ) as value from public.calls, bounds b
  ),
  spend as (
    select jsonb_build_object(
      'today', jsonb_build_object(
        'live_minutes', coalesce(sum(ceil(duration_seconds / 60.0))
          filter (where mode = 'live' and queued_at >= b.today_start), 0),
        'simulated_calls', count(*) filter (where mode = 'simulated'
          and status = 'completed' and queued_at >= b.today_start)),
      'month', jsonb_build_object(
        'live_minutes', coalesce(sum(ceil(duration_seconds / 60.0))
          filter (where mode = 'live'), 0),
        'simulated_calls', count(*) filter (where mode = 'simulated' and status = 'completed'))
    ) as value from public.calls c, bounds b where c.queued_at >= b.month_start
  ),
  errors as (
    select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb) as value
      from (
        select trace_id, source, step, error_code, created_at from recent
         where status = 'error' order by created_at desc limit 20
      ) e
  )
  select jsonb_build_object(
    'windows', (select value from windows),
    'sources', (select value from sources),
    'tools', (select value from tools),
    'llm', (select value from llm),
    'tokens', (select value from tokens),
    'paths', (select value from paths),
    'followups', (select value from followups),
    'spend', (select value from spend),
    'recent_errors', (select value from errors));
$$;
revoke execute on function public.ops_summary() from public, anon, authenticated;
grant execute on function public.ops_summary() to service_role;

-- The failure alert (ops/watch.ts): one row per problem per 15-minute window. The unique rule is
-- what makes "one alert, not fifty" true even if two watch runs overlap.
create table public.ops_alerts (
  id uuid primary key default gen_random_uuid(),
  -- "<function>|<step>|<error code>", or "followups_stuck".
  alert_key text not null,
  -- Whole 15-minute windows since 1970.
  alert_window bigint not null,
  error_count integer not null check (error_count > 0),
  trace_id uuid,
  created_at timestamptz not null default now(),
  unique (alert_key, alert_window)
);
alter table public.ops_alerts enable row level security;

-- Every 5 minutes: look for new failures and alert the ops number (same worker, same Vault
-- secrets as the other jobs).
select cron.schedule('ops-watch', '*/5 * * * *',
  $$select public.call_followup_worker('/ops-watch')$$);
