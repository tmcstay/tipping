-- DB tests for public.confirm_grandtour_rider_master_link(), the RPC that
-- actually writes grandtour_riders.master_rider_id (and optionally resolves
-- a uci_rider_review_queue item + inserts an alias) in one transaction.
-- See supabase/migrations/20260717060000_confirm_grandtour_rider_master_link_rpc.sql.
--
-- Run against local Supabase only, e.g.:
--   docker exec -i supabase_db_tipping-suite psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/confirm_grandtour_rider_master_link.sql
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
  ('f7000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'confirm-link-admin@example.test', '', now(), now()),
  ('f7000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'confirm-link-nonadmin@example.test', '', now(), now());

update public.user_app_memberships membership
set role = 'admin'
from public.apps app
where membership.app_id = app.id
  and membership.user_id = 'f7000000-0000-4000-8000-000000000001'
  and app.code = 'cycling';

insert into public.grand_tours (id, name, year, preselection_locks_at)
values ('f7000000-0000-4000-8000-0000000000a0', 'Confirm Link Test Tour', 2099, now());

insert into public.grandtour_riders (id, grand_tour_id, display_name, normalized_name)
values ('f7000000-0000-4000-8000-0000000000b0', 'f7000000-0000-4000-8000-0000000000a0', 'Test Rider One', 'test rider one');

insert into public.uci_riders (id, display_name, normalized_name, discipline)
values ('f7000000-0000-4000-8000-0000000000c0', 'Test Rider One', 'test rider one', 'road');

insert into public.uci_rider_review_queue (id, queue_type, status, rider_id, grandtour_rider_id, candidate_payload, source)
values (
  'f7000000-0000-4000-8000-0000000000d0',
  'ambiguous_candidate',
  'pending',
  'f7000000-0000-4000-8000-0000000000c0',
  'f7000000-0000-4000-8000-0000000000b0',
  '{}'::jsonb,
  'test'
);

\echo '=== 1. happy path: service_role confirms a link, master_rider_id is set ==='
set local role service_role;
select public.confirm_grandtour_rider_master_link(
  'f7000000-0000-4000-8000-0000000000b0'::uuid,
  'f7000000-0000-4000-8000-0000000000c0'::uuid,
  'f7000000-0000-4000-8000-000000000001'::uuid
);
reset role;

select pg_temp.assert_true(
  (select master_rider_id from public.grandtour_riders where id = 'f7000000-0000-4000-8000-0000000000b0') = 'f7000000-0000-4000-8000-0000000000c0'::uuid,
  'master_rider_id must be set to the confirmed uci_riders id'
);

\echo '=== 2. idempotent re-confirm: same pair again returns no_change, link unchanged ==='
do $$
declare
  v_result jsonb;
begin
  set local role service_role;
  select public.confirm_grandtour_rider_master_link(
    'f7000000-0000-4000-8000-0000000000b0'::uuid,
    'f7000000-0000-4000-8000-0000000000c0'::uuid,
    'f7000000-0000-4000-8000-000000000001'::uuid
  ) into v_result;
  reset role;

  perform pg_temp.assert_true(v_result ->> 'status' = 'no_change', 'a repeat confirmation of the same link must report no_change');
end;
$$;

select pg_temp.assert_true(
  (select master_rider_id from public.grandtour_riders where id = 'f7000000-0000-4000-8000-0000000000b0') = 'f7000000-0000-4000-8000-0000000000c0'::uuid,
  'master_rider_id must remain the confirmed uci_riders id after a repeat confirmation'
);

\echo '=== 3. non-admin, non-service caller is rejected ==='
do $$
begin
  begin
    set local role authenticated;
    perform pg_temp.authenticate('f7000000-0000-4000-8000-000000000002');
    perform public.confirm_grandtour_rider_master_link(
      'f7000000-0000-4000-8000-0000000000b0'::uuid,
      'f7000000-0000-4000-8000-0000000000c0'::uuid,
      'f7000000-0000-4000-8000-000000000002'::uuid
    );
    raise exception 'non-admin call to confirm_grandtour_rider_master_link unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%GrandTour administrator access is required%' then
      raise;
    end if;
  end;
  reset role;
end;
$$;

\echo '=== 4. review-item-linking case: an authenticated admin confirms, review item is marked matched ==='
do $$
declare
  v_result jsonb;
begin
  set local role authenticated;
  perform pg_temp.authenticate('f7000000-0000-4000-8000-000000000001');
  select public.confirm_grandtour_rider_master_link(
    'f7000000-0000-4000-8000-0000000000b0'::uuid,
    'f7000000-0000-4000-8000-0000000000c0'::uuid,
    'f7000000-0000-4000-8000-000000000001'::uuid,
    'f7000000-0000-4000-8000-0000000000d0'::uuid,
    'confirmed via admin review page'
  ) into v_result;
  reset role;

  perform pg_temp.assert_true((v_result ->> 'review_item_id')::uuid = 'f7000000-0000-4000-8000-0000000000d0'::uuid, 'the review item id must be echoed back');
end;
$$;

select pg_temp.assert_true(
  (select status from public.uci_rider_review_queue where id = 'f7000000-0000-4000-8000-0000000000d0') = 'matched',
  'the linked review-queue item must be marked matched'
);
select pg_temp.assert_true(
  (select resolved_by from public.uci_rider_review_queue where id = 'f7000000-0000-4000-8000-0000000000d0') = 'f7000000-0000-4000-8000-000000000001'::uuid,
  'resolved_by must be set to the confirming admin'
);
select pg_temp.assert_true(
  (select resolution_note from public.uci_rider_review_queue where id = 'f7000000-0000-4000-8000-0000000000d0') = 'confirmed via admin review page',
  'resolution_note must be recorded'
);

\echo '=== 5. a nonexistent grandtour_rider_id raises ==='
do $$
begin
  begin
    set local role service_role;
    perform public.confirm_grandtour_rider_master_link(
      'f7000000-0000-4000-8000-0000000000ff'::uuid,
      'f7000000-0000-4000-8000-0000000000c0'::uuid,
      'f7000000-0000-4000-8000-000000000001'::uuid
    );
    raise exception 'confirming a link for a nonexistent grandtour_rider_id unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%no public.grandtour_riders row found%' then
      raise;
    end if;
  end;
  reset role;
end;
$$;

select 'confirm_grandtour_rider_master_link RPC tests passed' as result;
rollback;
