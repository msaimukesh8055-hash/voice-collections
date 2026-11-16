-- supabase/migrations/20261116000001_ops_skip_eval.sql
-- M9 follow-up: requests made for eval owners (owners.is_eval) carry detail.eval = true on every
-- ops event of their trace. The ops page's error rate, per-function numbers, LLM answer counts and
-- recent errors leave them out, so an eval run cannot move the production error rate. Same
-- function as 20261111000001 with one change, in `recent`. Additive only.

create or replace function public.ops_summary()
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
  -- Eval traffic (detail.eval, set for eval owners' requests) is left out of every count here.
  -- Token spend below still includes it: that money was really spent.
  recent as (
    select e.* from public.ops_events e, bounds b
     where e.created_at >= b.week_ago and not (e.detail ? 'eval')
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
