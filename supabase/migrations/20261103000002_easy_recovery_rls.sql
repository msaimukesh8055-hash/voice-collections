-- supabase/migrations/20261103000002_easy_recovery_rls.sql
-- Row Level Security on every table, with NO policies for the anon/authenticated roles: the
-- browser cannot read or write any table directly. All access goes through Edge Functions using
-- the service role (security.md → Data access). The balances view runs with the caller's rights
-- (security_invoker), so it is blocked for the browser too.

do $$
declare
  t text;
begin
  foreach t in array array[
    'owners', 'shopkeepers', 'calls', 'ledger_entries', 'promises', 'tool_events',
    'shopkeeper_notes', 'followup_runs', 'followups', 'eval_runs', 'eval_results', 'publishes',
    'demo_settings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- The trigger function is only for the promises trigger; nobody may call it through the API.
revoke execute on function public.replace_open_promises() from public, anon, authenticated;
