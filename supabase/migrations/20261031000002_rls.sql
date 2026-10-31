-- supabase/migrations/20261031000002_rls.sql
-- Row Level Security on every table, with NO policies for anon/authenticated roles.
-- Effect: the browser (anon key) cannot read or write any table directly.
-- All access goes through Edge Functions using the service role (security.md → Data access).

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'loans', 'payments', 'calls', 'tool_events', 'call_results',
    'followup_runs', 'followups', 'customer_notes', 'promises', 'handoffs',
    'policy_chunks', 'eval_runs', 'eval_results', 'publishes', 'demo_settings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
