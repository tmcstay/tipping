-- DB tests for Part D's favourite-riders table/RLS:
--   public.grandtour_favourite_riders
-- See supabase/migrations/20260712010000_grandtour_favourite_riders.sql.
--
-- Run against local Supabase only, e.g.:
--   docker exec -i supabase_db_tipping-suite psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/grandtour_favourite_riders.sql
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

-- Fixture: one grand tour, one team, two riders, an admin user, and two
-- regular users.
insert into public.grand_tours (id, name, year, starts_at, ends_at, preselection_locks_at)
values ('f1000000-0000-4000-8000-000000000001', 'Favourites Test Tour', 2097, now() + interval '2 days', now() + interval '10 days', now() + interval '1 day');

insert into public.grandtour_teams (id, grand_tour_id, name, short_name)
values ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Favourites Test Team', 'FAV');

insert into public.grandtour_riders (id, grand_tour_id, team_id, display_name, normalized_name, bib_number)
values
  ('f3000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Favourite Rider One', 'favourite rider one', 1),
  ('f3000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Favourite Rider Two', 'favourite rider two', 2);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('f6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'favourites-admin@example.test', '', now(), now()),
  ('f6000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'favourites-user-a@example.test', '', now(), now()),
  ('f6000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'favourites-user-b@example.test', '', now(), now());

update public.user_app_memberships membership
set role = 'admin'
from public.apps app
where membership.app_id = app.id
  and membership.user_id = 'f6000000-0000-4000-8000-000000000001'
  and app.code = 'cycling';

\echo '=== 1. a user can add a favourite for themselves ==='
set local role authenticated;
select pg_temp.authenticate('f6000000-0000-4000-8000-000000000002');
insert into public.grandtour_favourite_riders (user_id, grand_tour_id, rider_id)
values ('f6000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001');
reset role;

select pg_temp.assert_true(
  (select count(*) = 1 from public.grandtour_favourite_riders where user_id = 'f6000000-0000-4000-8000-000000000002'),
  'user A must have exactly one favourite after inserting one'
);

\echo '=== 2. a user cannot insert a favourite row for a different user_id ==='
do $$
begin
  begin
    set local role authenticated;
    perform pg_temp.authenticate('f6000000-0000-4000-8000-000000000002');
    insert into public.grandtour_favourite_riders (user_id, grand_tour_id, rider_id)
    values ('f6000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000002');
    raise exception 'inserting a favourite for a different user unexpectedly succeeded';
  exception when insufficient_privilege or others then
    if sqlerrm not like '%new row violates row-level security%' and sqlerrm not like '%insufficient_privilege%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 3. a user cannot read another user''s favourites ==='
set local role authenticated;
select pg_temp.authenticate('f6000000-0000-4000-8000-000000000003');
select count(*) as visible_to_user_b from public.grandtour_favourite_riders where user_id = 'f6000000-0000-4000-8000-000000000002' \gset
reset role;
select pg_temp.assert_true(:visible_to_user_b = 0, 'user B must see zero of user A''s favourite rows, even when explicitly filtering by user A''s id');

\echo '=== 4. a user sees only their own favourites in an unfiltered select ==='
set local role authenticated;
select pg_temp.authenticate('f6000000-0000-4000-8000-000000000002');
insert into public.grandtour_favourite_riders (user_id, grand_tour_id, rider_id)
values ('f6000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000002');
select count(*) as own_favourites from public.grandtour_favourite_riders \gset
reset role;
select pg_temp.assert_true(:own_favourites = 2, 'user A must see exactly their own 2 favourite rows in an unfiltered select');

\echo '=== 5. a cycling admin can read another user''s favourites ==='
set local role authenticated;
select pg_temp.authenticate('f6000000-0000-4000-8000-000000000001');
select count(*) as admin_visible from public.grandtour_favourite_riders where user_id = 'f6000000-0000-4000-8000-000000000002' \gset
reset role;
select pg_temp.assert_true(:admin_visible = 2, 'a cycling admin must be able to read another user''s favourite rows');

\echo '=== 6. a cycling admin cannot write a favourite on another user''s behalf (only select is granted) ==='
do $$
begin
  begin
    set local role authenticated;
    perform pg_temp.authenticate('f6000000-0000-4000-8000-000000000001');
    insert into public.grandtour_favourite_riders (user_id, grand_tour_id, rider_id)
    values ('f6000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001');
    raise exception 'admin inserting a favourite for another user unexpectedly succeeded';
  exception when insufficient_privilege or others then
    if sqlerrm not like '%new row violates row-level security%' and sqlerrm not like '%insufficient_privilege%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 7. removing (toggling off) a favourite works and only affects the owner''s row ==='
set local role authenticated;
select pg_temp.authenticate('f6000000-0000-4000-8000-000000000002');
delete from public.grandtour_favourite_riders
where user_id = 'f6000000-0000-4000-8000-000000000002'
  and grand_tour_id = 'f1000000-0000-4000-8000-000000000001'
  and rider_id = 'f3000000-0000-4000-8000-000000000001';
select count(*) as remaining from public.grandtour_favourite_riders \gset
reset role;
select pg_temp.assert_true(:remaining = 1, 'user A must have exactly 1 favourite remaining after removing one of 2');

\echo '=== 8. duplicate favourite insert is rejected by the unique constraint (toggle-on must check first, or use upsert) ==='
do $$
begin
  begin
    set local role authenticated;
    perform pg_temp.authenticate('f6000000-0000-4000-8000-000000000002');
    insert into public.grandtour_favourite_riders (user_id, grand_tour_id, rider_id)
    values ('f6000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000002');
    raise exception 'duplicate favourite insert unexpectedly succeeded';
  exception when unique_violation then null;
  end;
  reset role;
end;
$$;

\echo '=== 9. anon cannot read or write favourites at all ==='
do $$
begin
  begin
    set local role anon;
    perform count(*) from public.grandtour_favourite_riders;
    raise exception 'anon select on grandtour_favourite_riders unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

select 'GrandTour favourite riders RLS/CRUD tests passed' as result;
rollback;
