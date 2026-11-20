-- supabase/migrations/20261120000003_call_scores.sql
-- Agent health (Saim, 2026-11-20): each call's scorecard result, kept when its report is worked
-- out, so the Agent health page can show trends across calls without scoring every call again.
-- One row per call, Asha's (calls.id) or Munshi's (owner_calls.id); updated when a call is scored
-- again (for example once its tone has been judged). Service role only. Additive.
create table public.call_scores (
  agent text not null check (agent in ('asha', 'munshi')),
  call_id uuid not null,
  started_at timestamptz not null,
  verdict text not null check (verdict in ('good', 'check', 'failed')),
  passed integer not null check (passed >= 0),
  applicable integer not null check (applicable >= 0),
  -- [{id, label, group, status}] for every check, including tools needed vs ran.
  checks jsonb not null,
  -- {point id: 1-5} from the AI tone judge; {} when not judged.
  tone jsonb not null default '{}'::jsonb,
  cost_inr numeric,
  reply_p50_ms integer,
  scored_at timestamptz not null default now(),
  primary key (agent, call_id)
);
create index call_scores_started_idx on public.call_scores (agent, started_at desc);

alter table public.call_scores enable row level security;
