-- supabase/migrations/20261101000001_call_limits_switch.sql
-- Demo switch for call-attempt limits (M2 Decision 2): the rule is built and tested but off by
-- default, so manual testing never hits 3 calls a day. Switch on to demo the rule.
alter table public.demo_settings
  add column call_limits_enabled boolean not null default false;
