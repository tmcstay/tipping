-- DB tests for public.get_grandtour_leaderboard_with_movement(...).
-- See supabase/migrations/20260714050000_grandtour_leaderboard_movement.sql.
--
-- Run against local Supabase only, e.g.:
--   docker exec -i supabase_db_tipping-suite psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/grandtour_leaderboard_movement.sql
-- Everything in this file runs inside one transaction that ends in ROLLBACK.
--
-- Directly inserts grandtour_tips/grandtour_stage_scores rows (bypassing
-- the submit-tip/recalculate-score RPCs, which are exercised elsewhere) -
-- this test is scoped to the movement RPC's own read-only aggregation
-- logic, not the scoring pipeline that produces those rows in production.

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

insert into public.grand_tours (id, name, year, starts_at, ends_at, preselection_locks_at)
values ('e1000000-0000-4000-8000-000000000001', 'Movement Test Tour', 2098, now() - interval '10 days', now() + interval '10 days', now() - interval '11 days');

-- Two stages: stage 1 (older, both users scored) and stage 2 (the latest -
-- the one "movement" is measured relative to).
insert into public.grandtour_stages (id, grand_tour_id, stage_number, stage_name, stage_type, starts_at, locks_at)
values
  ('e4000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 1, 'Movement Test Stage 1', 'road', now() - interval '9 days', now() - interval '9 days'),
  ('e4000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 2, 'Movement Test Stage 2', 'road', now() - interval '8 days', now() - interval '8 days');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('e6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'movement-user-a@example.test', '', now(), now()),
  ('e6000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'movement-user-b@example.test', '', now(), now()),
  ('e6000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'movement-user-c@example.test', '', now(), now());

update public.profiles set display_name = 'Movement User A' where id = 'e6000000-0000-4000-8000-000000000001';
update public.profiles set display_name = 'Movement User B' where id = 'e6000000-0000-4000-8000-000000000002';
update public.profiles set display_name = 'Movement User C' where id = 'e6000000-0000-4000-8000-000000000003';

insert into public.competitions (id, app_id, competition_key, name, sport_type, is_active, is_public)
select 'e8000000-0000-4000-8000-000000000001', app.id, 'movement-test-competition', 'Movement Test League', 'cycling', true, true
from public.apps app
where app.code = 'cycling';

insert into public.grandtour_competitions (id, grand_tour_id, competition_id, name, is_public, allow_preselection, allow_daily)
values ('e8000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'Movement Test League', true, true, true);

-- Bypass the tip-entry kill switch trigger - this test writes directly to
-- grandtour_tips/grandtour_stage_scores rather than through the tip-entry
-- RPCs, so the switch is irrelevant to what's being tested here.
select set_config('grandtour.admin_override', 'on', true);

-- User A: stage 1 = 10, stage 2 = 5 -> total 15, previous (excluding stage 2) = 10.
-- User B: stage 1 = 5, stage 2 = 20 -> total 25, previous = 5.
-- User C: only scored stage 2 (the latest) = 8 -> total 8, previous score 0 with zero prior stages -> "New" (previous_rank null).
insert into public.grandtour_tips (id, user_id, competition_id, stage_id, tip_mode, tip_scope, status, total_score)
values
  ('e9000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'daily', 'stage', 'scored', 10),
  ('e9000000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002', 'daily', 'stage', 'scored', 5),
  ('e9000000-0000-4000-8000-000000000003', 'e6000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'daily', 'stage', 'scored', 5),
  ('e9000000-0000-4000-8000-000000000004', 'e6000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002', 'daily', 'stage', 'scored', 20),
  ('e9000000-0000-4000-8000-000000000005', 'e6000000-0000-4000-8000-000000000003', 'e8000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002', 'daily', 'stage', 'scored', 8);

-- grandtour_stage_scores' insert trigger requires the stage to already have
-- a final result, and a final non-TTT result must have 5 or 10 result
-- lines - a minimal 5-rider result satisfies both; this test never reads
-- the result content itself.
insert into public.grandtour_teams (id, grand_tour_id, name, short_name)
values ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Movement Test Team', 'MVT');

insert into public.grandtour_riders (id, grand_tour_id, team_id, display_name, normalized_name, bib_number)
select
  ('e3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'e1000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'Movement Rider ' || n,
  'movement rider ' || n,
  n
from generate_series(1, 5) n;

-- Inserted as a draft first, then flipped to final only after its result
-- lines exist - validate_final_result() checks line count at the moment
-- is_final becomes true, which would otherwise see zero lines.
insert into public.grandtour_stage_startlists (stage_id, rider_id, team_id, status)
select stage.id, rider.id, rider.team_id, 'confirmed'
from public.grandtour_stages stage
cross join public.grandtour_riders rider
where stage.grand_tour_id = 'e1000000-0000-4000-8000-000000000001'
  and rider.grand_tour_id = stage.grand_tour_id;

insert into public.grandtour_stage_results (id, stage_id, is_final, review_status, source_mode)
values
  ('e5000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', false, 'imported', 'test'),
  ('e5000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000002', false, 'imported', 'test');

insert into public.grandtour_stage_result_lines (stage_result_id, rider_id, actual_position)
select result.id, rider.id, rider.bib_number
from public.grandtour_riders rider
cross join (values
  ('e5000000-0000-4000-8000-000000000001'::uuid),
  ('e5000000-0000-4000-8000-000000000002'::uuid)
) as result(id)
where rider.grand_tour_id = 'e1000000-0000-4000-8000-000000000001';

insert into public.grandtour_stage_jersey_holders (stage_id, jersey_type, rider_id)
select stage.id, jersey.jersey_type, ('e3000000-0000-4000-8000-000000000001')::uuid
from public.grandtour_stages stage
cross join (values ('yellow'::public.grandtour_jersey_type), ('green'), ('kom'), ('white')) as jersey(jersey_type)
where stage.grand_tour_id = 'e1000000-0000-4000-8000-000000000001';

update public.grandtour_stage_results
set is_final = true, review_status = 'finalised'
where id in ('e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002');

insert into public.grandtour_stage_scores (tip_id, user_id, competition_id, stage_id, tip_mode, tip_scope, top5_score, jersey_score, bonus_score, total_score, is_prize_eligible)
values
  ('e9000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'daily', 'stage', 10, 0, 0, 10, true),
  ('e9000000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002', 'daily', 'stage', 5, 0, 0, 5, true),
  ('e9000000-0000-4000-8000-000000000003', 'e6000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'daily', 'stage', 5, 0, 0, 5, true),
  ('e9000000-0000-4000-8000-000000000004', 'e6000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002', 'daily', 'stage', 20, 0, 0, 20, true),
  ('e9000000-0000-4000-8000-000000000005', 'e6000000-0000-4000-8000-000000000003', 'e8000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002', 'daily', 'stage', 8, 0, 0, 8, true);

set local role authenticated;
select pg_temp.authenticate('e6000000-0000-4000-8000-000000000001');

\echo '=== 1. current standings are correct: B (25) ranks above A (15) above C (8) ==='
select pg_temp.assert_true(
  (select rank from public.get_grandtour_leaderboard_with_movement('e8000000-0000-4000-8000-000000000001', 'overall') where user_id = 'e6000000-0000-4000-8000-000000000002') = 1,
  'User B (total 25) must rank 1'
);
select pg_temp.assert_true(
  (select rank from public.get_grandtour_leaderboard_with_movement('e8000000-0000-4000-8000-000000000001', 'overall') where user_id = 'e6000000-0000-4000-8000-000000000001') = 2,
  'User A (total 15) must rank 2'
);
select pg_temp.assert_true(
  (select rank from public.get_grandtour_leaderboard_with_movement('e8000000-0000-4000-8000-000000000001', 'overall') where user_id = 'e6000000-0000-4000-8000-000000000003') = 3,
  'User C (total 8) must rank 3'
);

\echo '=== 2. User A moved down (previous rank 1 -> current rank 2) ==='
select pg_temp.assert_true(
  (select previous_rank from public.get_grandtour_leaderboard_with_movement('e8000000-0000-4000-8000-000000000001', 'overall') where user_id = 'e6000000-0000-4000-8000-000000000001') = 1,
  'User A previous_rank (score 10 before stage 2) must be 1'
);

\echo '=== 3. User B moved up (previous rank 2 -> current rank 1) ==='
select pg_temp.assert_true(
  (select previous_rank from public.get_grandtour_leaderboard_with_movement('e8000000-0000-4000-8000-000000000001', 'overall') where user_id = 'e6000000-0000-4000-8000-000000000002') = 2,
  'User B previous_rank (score 5 before stage 2) must be 2'
);

\echo '=== 4. User C, who only scored the latest stage, has no previous rank (null, never a fabricated number) ==='
select pg_temp.assert_true(
  (select previous_rank from public.get_grandtour_leaderboard_with_movement('e8000000-0000-4000-8000-000000000001', 'overall') where user_id = 'e6000000-0000-4000-8000-000000000003') is null,
  'User C previous_rank must be null ("New") since they have no scored stage before the latest one'
);

reset role;

rollback;
