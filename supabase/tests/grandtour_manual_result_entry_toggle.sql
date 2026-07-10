-- DB tests for public.set_grandtour_manual_result_entry_enabled(...).
-- See supabase/migrations/20260710020000_grandtour_stage_result_review_workflow_schema.sql.
--
-- Run against local Supabase only, e.g.:
--   docker exec -i supabase_db_tipping-suite psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/grandtour_manual_result_entry_toggle.sql
-- Everything in this file runs inside one transaction that ends in ROLLBACK.

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if not coalesce(condition, false) then
    raise exception 'assertion failed: %', message;
  end if;
end;
$$;

insert into public.grand_tours (id, name, year, starts_at, ends_at, preselection_locks_at)
values ('e1000000-0000-4000-8000-000000000001', 'Manual Entry Toggle Test Tour', 2099, now() + interval '2 days', now() + interval '10 days', now() + interval '1 day');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('e2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manual-entry-admin@example.test', '', now(), now());

\echo '=== 1. manual_result_entry_enabled defaults to false ==='
select pg_temp.assert_true(
  (select manual_result_entry_enabled = false from public.grand_tours where id = 'e1000000-0000-4000-8000-000000000001'),
  'manual_result_entry_enabled must default to false'
);

\echo '=== 2. anon cannot call the RPC ==='
do $$
begin
  begin
    set local role anon;
    perform public.set_grandtour_manual_result_entry_enabled('e1000000-0000-4000-8000-000000000001', true, 'e2000000-0000-4000-8000-000000000001');
    raise exception 'anon call unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

\echo '=== 3. refuses an unknown grand tour ==='
do $$
begin
  begin
    set local role service_role;
    perform public.set_grandtour_manual_result_entry_enabled('e1000000-0000-4000-8000-00000000ffff', true, 'e2000000-0000-4000-8000-000000000001');
    raise exception 'toggle for a nonexistent grand tour unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%no grand_tours row found%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 4. service_role can enable manual result entry, and it is logged to grandtour_game_audit ==='
set local role service_role;
select public.set_grandtour_manual_result_entry_enabled(
  'e1000000-0000-4000-8000-000000000001',
  true,
  'e2000000-0000-4000-8000-000000000001',
  'letour.fr feed down for stage 6, enabling manual entry'
) as enable_result \gset
reset role;

select pg_temp.assert_true(
  (:'enable_result'::jsonb ->> 'manual_result_entry_enabled')::boolean = true,
  'enable call must return manual_result_entry_enabled=true'
);
select pg_temp.assert_true(
  (select manual_result_entry_enabled from public.grand_tours where id = 'e1000000-0000-4000-8000-000000000001') = true,
  'grand_tours.manual_result_entry_enabled must be true after enabling'
);
select pg_temp.assert_true(
  (select count(*) = 1
   from public.grandtour_game_audit
   where entity_type = 'grand_tours'
     and entity_id = 'e1000000-0000-4000-8000-000000000001'
     and action = 'admin_override'
     and actor_user_id = 'e2000000-0000-4000-8000-000000000001'
     and (new_value ->> 'manual_result_entry_enabled')::boolean = true),
  'exactly one admin_override audit row must exist recording the enable'
);

\echo '=== 5. service_role can disable it again, and that is logged too ==='
set local role service_role;
select public.set_grandtour_manual_result_entry_enabled(
  'e1000000-0000-4000-8000-000000000001',
  false,
  'e2000000-0000-4000-8000-000000000001',
  'official feed restored for stage 6'
) as disable_result \gset
reset role;

select pg_temp.assert_true(
  (:'disable_result'::jsonb ->> 'manual_result_entry_enabled')::boolean = false,
  'disable call must return manual_result_entry_enabled=false'
);
select pg_temp.assert_true(
  (select manual_result_entry_enabled from public.grand_tours where id = 'e1000000-0000-4000-8000-000000000001') = false,
  'grand_tours.manual_result_entry_enabled must be false after disabling'
);
select pg_temp.assert_true(
  (select count(*) = 2
   from public.grandtour_game_audit
   where entity_type = 'grand_tours'
     and entity_id = 'e1000000-0000-4000-8000-000000000001'
     and action = 'admin_override'),
  'exactly two admin_override audit rows must exist now (enable + disable)'
);

select 'GrandTour manual result entry toggle RPC tests passed' as result;
rollback;
