-- supabase/migrations/20261115000001_eval_owners.sql
-- M9 Build F: eval data is flagged, not guessed. Every eval run creates its own owner(s) with
-- fake shopkeepers so test rows never mix into the real book; these columns mark such owners
-- explicitly, say which agent's evals made them and which run, and let the clean-up command
-- find them. Additive: three columns (default "not eval"), a backfill of the owners earlier Asha
-- runs created (they carry the city marker evals/sarvam/eval-data.ts writes), and one function
-- that deletes a single eval owner and everything under it.

alter table public.owners
  add column is_eval boolean not null default false,
  add column eval_agent text check (eval_agent in ('asha', 'munshi')),
  add column eval_run text;

alter table public.owners
  add constraint owners_eval_fields_only_for_eval
  check (is_eval or (eval_agent is null and eval_run is null));

comment on column public.owners.is_eval is
  'M9 Build F: true = an owner created by an eval run (fake data). The app''s real owner is the first owner with is_eval = false.';
comment on column public.owners.eval_agent is
  'M9 Build F: which agent''s eval run created this owner (asha / munshi); null for the real owner.';
comment on column public.owners.eval_run is
  'M9 Build F: the eval run that created this owner (a Munshi run creates one owner per case).';

update public.owners
  set is_eval = true, eval_agent = 'asha', eval_run = id::text
  where city = 'EVAL DATA (not a real owner)';

-- Deletes ONE eval owner and every row under it, child tables first, in one transaction. Refuses
-- (raises) for any owner that is not flagged is_eval, so the real book can never be reached.
create function public.delete_eval_owner(target uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.owners o where o.id = target and o.is_eval) then
    raise exception 'delete_eval_owner: % is not an eval owner', target using errcode = 'P0001';
  end if;

  delete from public.ledger_reversals r
   where r.owner_call_id in (select oc.id from public.owner_calls oc where oc.owner_id = target)
      or r.entry_id in (
        select e.id from public.ledger_entries e
         where e.shopkeeper_id in (select s.id from public.shopkeepers s where s.owner_id = target));
  delete from public.tool_events t where t.call_id in (select c.id from public.calls c where c.shopkeeper_id in (select s.id from public.shopkeepers s where s.owner_id = target));
  delete from public.shopkeeper_notes n where n.shopkeeper_id in (select s.id from public.shopkeepers s where s.owner_id = target);
  delete from public.followup_runs f where f.shopkeeper_id in (select s.id from public.shopkeepers s where s.owner_id = target);
  delete from public.followups f where f.shopkeeper_id in (select s.id from public.shopkeepers s where s.owner_id = target);
  delete from public.promises p where p.shopkeeper_id in (select s.id from public.shopkeepers s where s.owner_id = target);
  delete from public.ledger_entries e where e.shopkeeper_id in (select s.id from public.shopkeepers s where s.owner_id = target);
  update public.demo_settings d set live_shopkeeper_id = null
   where d.live_shopkeeper_id in (select s.id from public.shopkeepers s where s.owner_id = target);
  delete from public.calls c
   where c.shopkeeper_id in (select s.id from public.shopkeepers s where s.owner_id = target);
  delete from public.shopkeepers s where s.owner_id = target;
  -- pending_actions, owner_alerts, owner_calls and owner_tool_events go with the owner (cascade).
  delete from public.owners o where o.id = target;
end;
$$;

-- Functions in public are callable with the anon key unless revoked: only the service role.
revoke execute on function public.delete_eval_owner(uuid) from public, anon, authenticated;

comment on function public.delete_eval_owner(uuid) is
  'M9 Build F: deletes one is_eval owner and all its rows; raises for any other owner.';
