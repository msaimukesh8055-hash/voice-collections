-- supabase/migrations/20261101000002_calling_hours_switch.sql
-- Demo switch for the 08:00-19:00 IST calling-hours rule (Saim, M2): the rule is built and
-- tested but off by default so testing works at any hour. Switch on to demo a blocked call.
alter table public.demo_settings
  add column calling_hours_enabled boolean not null default false;
