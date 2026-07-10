-- DB tests for public.is_current_user_cycling_admin(), the public wrapper
-- around the fixed grandtour_private.is_cycling_admin() check.
-- See supabase/migrations/20260713010000_grandtour_is_current_user_cycling_admin_rpc.sql.
--
-- Run against local Supabase only, e.g.:
--   docker exec -i supabase_db_tipping-suite psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/grandtour_is_current_user_cycling_admin.sql
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

create or replace function pg_temp.authenticate(test_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', test_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('e6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-check-admin@example.test', '', now(), now()),
  ('e6000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-check-nonadmin@example.test', '', now(), now());

update public.user_app_memberships membership
set role = 'admin'
from public.apps app
where membership.app_id = app.id
  and membership.user_id = 'e6000000-0000-4000-8000-000000000001'
  and app.code = 'cycling';

\echo '=== 1. a cycling admin session gets true ==='
set local role authenticated;
select pg_temp.authenticate('e6000000-0000-4000-8000-000000000001');
select pg_temp.assert_true(
  (select public.is_current_user_cycling_admin()),
  'an active cycling admin must get true'
);
reset role;

\echo '=== 2. a non-admin authenticated session gets false (not NULL) ==='
set local role authenticated;
select pg_temp.authenticate('e6000000-0000-4000-8000-000000000002');
select pg_temp.assert_true(
  (select public.is_current_user_cycling_admin() = false),
  'a non-admin authenticated user must get false, not NULL'
);
reset role;

\echo '=== 3. an anon caller cannot execute the function at all (no EXECUTE grant) ==='
do $$
begin
  begin
    set local role anon;
    perform public.is_current_user_cycling_admin();
    raise exception 'anon call to is_current_user_cycling_admin() unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

select 'is_current_user_cycling_admin RPC tests passed' as result;
rollback;
