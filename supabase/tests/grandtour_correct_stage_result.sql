-- DB tests for the GrandTour result correction workflow:
--   public.correct_grandtour_stage_result_from_reviewed_report(...)
-- See supabase/migrations/20260711010000_grandtour_correct_stage_result_rpc.sql.
--
-- Run against local Supabase only, e.g.:
--   docker exec -i supabase_db_tipping-suite psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/grandtour_correct_stage_result.sql
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

-- Self-contained fixture: one test grand tour, one team, ten riders, a
-- competition, and three road stages:
--   stage 2: draft/imported result (10 lines + 4 jerseys), never checked.
--   stage 3: finalised (admin_checked -> finalised), never scored.
--   stage 4: finalised AND scored (one real tip + score row), for the
--            score-clearing/tip-status-reset scenarios.
-- Plus an admin user and a non-admin user.

insert into public.grand_tours (id, name, year, starts_at, ends_at, preselection_locks_at)
values ('e1000000-0000-4000-8000-000000000001', 'Correction RPC Test Tour', 2098, now() + interval '2 days', now() + interval '10 days', now() + interval '1 day');

insert into public.grandtour_teams (id, grand_tour_id, name, short_name)
values ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Correction Test Team', 'CTT');

insert into public.grandtour_riders (id, grand_tour_id, team_id, display_name, normalized_name, bib_number)
select
  ('e3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'e1000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'Correction Rider ' || n,
  'correction rider ' || n,
  n
from generate_series(1, 12) n;

insert into public.competitions (id, app_id, competition_key, name, sport_type, is_active, is_public)
select 'e7500000-0000-4000-8000-000000000001', app.id, 'correction-rpc-test', 'Correction Test Competition', 'cycling', true, true
from public.apps app
where app.code = 'cycling';

insert into public.grandtour_competitions (id, grand_tour_id, competition_id, name, is_public)
values ('e7000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'e7500000-0000-4000-8000-000000000001', 'Correction Test Competition', true);

insert into public.grandtour_stages (id, grand_tour_id, stage_number, stage_name, stage_type, ttt_timing_rule, starts_at, locks_at)
values
  ('e4000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 2, 'Correction Test Stage 2 (draft)', 'road', null, now() + interval '2 days', now() + interval '1 day'),
  ('e4000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001', 3, 'Correction Test Stage 3 (finalised, unscored)', 'road', null, now() + interval '3 days', now() + interval '2 days'),
  ('e4000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000001', 4, 'Correction Test Stage 4 (finalised + scored)', 'road', null, now() + interval '4 days', now() + interval '3 days'),
  ('e4000000-0000-4000-8000-000000000009', 'e1000000-0000-4000-8000-000000000001', 9, 'Correction Test TTT Stage', 'ttt', 'individual_time', now() + interval '4 days', now() + interval '3 days');

insert into public.grandtour_stage_startlists (stage_id, rider_id, team_id, status)
select stage.id, rider.id, rider.team_id, 'confirmed'
from public.grandtour_stages stage
cross join public.grandtour_riders rider
where stage.grand_tour_id = 'e1000000-0000-4000-8000-000000000001'
  and rider.grand_tour_id = stage.grand_tour_id;

-- Helper: builds a 10-line/4-jersey result for a given stage, using riders
-- 1-10 for lines (position = n) and riders 1-4 for jerseys
-- (yellow/green/kom/white respectively).
create function pg_temp.insert_stage_result(
  p_stage_id uuid, p_result_id uuid, p_is_final boolean, p_review_status text
) returns void language plpgsql as $$
begin
  -- grandtour_private.validate_final_result() requires 5 or 10 result
  -- lines to ALREADY exist at the moment is_final becomes true, and
  -- grandtour_stage_results_final_review_status_check requires
  -- is_final = (review_status = 'finalised') at all times - so this always
  -- inserts as is_final=false/review_status='imported' first, adds the
  -- lines/jerseys, then flips both together in a separate UPDATE once the
  -- lines are really there.
  insert into public.grandtour_stage_results (id, stage_id, is_final, review_status, source_mode)
  values (p_result_id, p_stage_id, false, 'imported', 'official_feed');

  insert into public.grandtour_stage_result_lines (stage_result_id, rider_id, actual_position)
  select p_result_id, rider.id, rider.bib_number
  from public.grandtour_riders rider
  where rider.grand_tour_id = 'e1000000-0000-4000-8000-000000000001'
    and rider.bib_number between 1 and 10;

  insert into public.grandtour_stage_jersey_holders (stage_id, jersey_type, rider_id)
  values
    (p_stage_id, 'yellow', 'e3000000-0000-4000-8000-000000000001'),
    (p_stage_id, 'green', 'e3000000-0000-4000-8000-000000000002'),
    (p_stage_id, 'kom', 'e3000000-0000-4000-8000-000000000003'),
    (p_stage_id, 'white', 'e3000000-0000-4000-8000-000000000004');

  if p_is_final then
    update public.grandtour_stage_results
    set is_final = true, review_status = p_review_status::public.grandtour_stage_result_review_status
    where id = p_result_id;
  elsif p_review_status <> 'imported' then
    update public.grandtour_stage_results
    set review_status = p_review_status::public.grandtour_stage_result_review_status
    where id = p_result_id;
  end if;
end;
$$;

select pg_temp.insert_stage_result('e4000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000002', false, 'imported');
select pg_temp.insert_stage_result('e4000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000003', true, 'finalised');
select pg_temp.insert_stage_result('e4000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000004', true, 'finalised');

update public.grandtour_stage_results set finalised_at = now(), finalised_by = null, finalisation_reason = 'fixture setup'
where id in ('e5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000004');

-- Admin and non-admin users.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('e6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'correction-admin@example.test', '', now(), now()),
  ('e6000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'correction-nonadmin@example.test', '', now(), now());

update public.user_app_memberships membership
set role = 'admin'
from public.apps app
where membership.app_id = app.id
  and membership.user_id = 'e6000000-0000-4000-8000-000000000001'
  and app.code = 'cycling';

-- A real submitted+scored tip for stage 4, to exercise score-clearing.
insert into public.grandtour_tips (id, user_id, competition_id, stage_id, tip_mode, tip_scope, status, submitted_at, total_score)
values ('e8000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000004', 'daily', 'stage', 'scored', now(), 30);

insert into public.grandtour_stage_scores (id, tip_id, user_id, competition_id, stage_id, tip_mode, tip_scope, top5_score, jersey_score, bonus_score, total_score)
values ('e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000004', 'daily', 'stage', 20, 10, 0, 30);

-- Reusable "valid reconciliation" builder: 10 matchedRiders (riders 1-10)
-- and 4 matched jerseyHolders (riders 1-4), all safe.
create function pg_temp.build_reconciliation(p_stage_number int, p_safe_to_apply boolean default true)
returns jsonb language sql as $$
  select jsonb_build_object(
    'stageNumber', p_stage_number,
    'isTtt', false,
    'missingStageRecord', false,
    'startlistValidationPassed', true,
    'unmatchedRiders', '[]'::jsonb,
    'ambiguousRiders', '[]'::jsonb,
    'unmatchedTeams', '[]'::jsonb,
    'ambiguousTeams', '[]'::jsonb,
    'duplicateBibConflicts', '[]'::jsonb,
    'safeToApply', p_safe_to_apply,
    'matchedRiders', (
      select jsonb_agg(jsonb_build_object('riderId', ('e3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid))
      from generate_series(1, 10) n
    ),
    'jerseyHolders', jsonb_build_array(
      jsonb_build_object('jerseyType', 'yellow', 'matchedRiderId', 'e3000000-0000-4000-8000-000000000001', 'status', 'matched'),
      jsonb_build_object('jerseyType', 'green', 'matchedRiderId', 'e3000000-0000-4000-8000-000000000002', 'status', 'matched'),
      jsonb_build_object('jerseyType', 'kom', 'matchedRiderId', 'e3000000-0000-4000-8000-000000000003', 'status', 'matched'),
      jsonb_build_object('jerseyType', 'white', 'matchedRiderId', 'e3000000-0000-4000-8000-000000000004', 'status', 'matched')
    )
  );
$$;

-- Reusable "10 corrected result lines" builder: same 10 riders, but swaps
-- positions 1 and 2 relative to the fixture (a genuine, detectable change).
create function pg_temp.build_swapped_lines()
returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('rider_id', 'e3000000-0000-4000-8000-000000000002', 'actual_position', 1),
    jsonb_build_object('rider_id', 'e3000000-0000-4000-8000-000000000001', 'actual_position', 2),
    jsonb_build_object('rider_id', 'e3000000-0000-4000-8000-000000000003', 'actual_position', 3),
    jsonb_build_object('rider_id', 'e3000000-0000-4000-8000-000000000004', 'actual_position', 4),
    jsonb_build_object('rider_id', 'e3000000-0000-4000-8000-000000000005', 'actual_position', 5),
    jsonb_build_object('rider_id', 'e3000000-0000-4000-8000-000000000006', 'actual_position', 6),
    jsonb_build_object('rider_id', 'e3000000-0000-4000-8000-000000000007', 'actual_position', 7),
    jsonb_build_object('rider_id', 'e3000000-0000-4000-8000-000000000008', 'actual_position', 8),
    jsonb_build_object('rider_id', 'e3000000-0000-4000-8000-000000000009', 'actual_position', 9),
    jsonb_build_object('rider_id', 'e3000000-0000-4000-8000-000000000010', 'actual_position', 10)
  );
$$;

-- The fixture's unchanged 10 lines (for the no_change idempotency test).
create function pg_temp.build_unchanged_lines()
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('rider_id', ('e3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'actual_position', n))
  from generate_series(1, 10) n;
$$;

create function pg_temp.build_jersey_holders()
returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('jersey_type', 'yellow', 'rider_id', 'e3000000-0000-4000-8000-000000000001'),
    jsonb_build_object('jersey_type', 'green', 'rider_id', 'e3000000-0000-4000-8000-000000000002'),
    jsonb_build_object('jersey_type', 'kom', 'rider_id', 'e3000000-0000-4000-8000-000000000003'),
    jsonb_build_object('jersey_type', 'white', 'rider_id', 'e3000000-0000-4000-8000-000000000004')
  );
$$;

\echo '=== 1. correction refuses a blank reason ==='
do $$
begin
  begin
    set local role service_role;
    perform public.correct_grandtour_stage_result_from_reviewed_report(
      'e4000000-0000-4000-8000-000000000002',
      pg_temp.build_swapped_lines(),
      pg_temp.build_jersey_holders(),
      pg_temp.build_reconciliation(2),
      '   '
    );
    raise exception 'correction with a blank reason unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%p_reason is required%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 2. correction refuses an unsafe reconciliation (safeToApply=false) ==='
do $$
begin
  begin
    set local role service_role;
    perform public.correct_grandtour_stage_result_from_reviewed_report(
      'e4000000-0000-4000-8000-000000000002',
      pg_temp.build_swapped_lines(),
      pg_temp.build_jersey_holders(),
      pg_temp.build_reconciliation(2, false),
      'fixing a parser bug'
    );
    raise exception 'correction with safeToApply=false unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%safeToApply must be true%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 3. correction refuses missing jersey holders (only 3 of 4) ==='
do $$
begin
  begin
    set local role service_role;
    perform public.correct_grandtour_stage_result_from_reviewed_report(
      'e4000000-0000-4000-8000-000000000002',
      pg_temp.build_swapped_lines(),
      (pg_temp.build_jersey_holders() - 3),
      pg_temp.build_reconciliation(2),
      'fixing a parser bug'
    );
    raise exception 'correction with 3 jersey holders unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%exactly 4 entries%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 4. correction updates a draft (never-finalised) result safely ==='
set local role service_role;
select public.correct_grandtour_stage_result_from_reviewed_report(
  'e4000000-0000-4000-8000-000000000002',
  pg_temp.build_swapped_lines(),
  pg_temp.build_jersey_holders(),
  pg_temp.build_reconciliation(2),
  'positions 1 and 2 were swapped in the original import',
  'correction-test-stage2-request'
) as stage2_correction_result \gset
reset role;

select pg_temp.assert_true((:'stage2_correction_result'::jsonb ->> 'status') = 'corrected', 'stage 2 correction must return status=corrected');
select pg_temp.assert_true((:'stage2_correction_result'::jsonb ->> 'was_finalised')::boolean = false, 'stage 2 was never finalised');
select pg_temp.assert_true((:'stage2_correction_result'::jsonb ->> 'scores_cleared')::int = 0, 'stage 2 had no scores to clear');
select pg_temp.assert_true(
  (select review_status from public.grandtour_stage_results where id = 'e5000000-0000-4000-8000-000000000002') = 'correction_required',
  'stage 2 review_status must become correction_required'
);
select pg_temp.assert_true(
  (select rider_id from public.grandtour_stage_result_lines where stage_result_id = 'e5000000-0000-4000-8000-000000000002' and actual_position = 1) = 'e3000000-0000-4000-8000-000000000002',
  'stage 2 position 1 must now be rider 2 (the swap took effect)'
);
select pg_temp.assert_true(
  (select count(*) = 10 from public.grandtour_stage_result_lines where stage_result_id = 'e5000000-0000-4000-8000-000000000002'),
  'stage 2 must still have exactly 10 result lines after correction'
);

\echo '=== 5. correction updates a finalised (unscored) result by unfinalising and setting correction_required ==='
set local role service_role;
select public.correct_grandtour_stage_result_from_reviewed_report(
  'e4000000-0000-4000-8000-000000000003',
  pg_temp.build_swapped_lines(),
  pg_temp.build_jersey_holders(),
  pg_temp.build_reconciliation(3),
  'the official feed had the wrong stage winner',
  'correction-test-stage3-request'
) as stage3_correction_result \gset
reset role;

select pg_temp.assert_true((:'stage3_correction_result'::jsonb ->> 'status') = 'corrected', 'stage 3 correction must return status=corrected');
select pg_temp.assert_true((:'stage3_correction_result'::jsonb ->> 'was_finalised')::boolean = true, 'stage 3 was finalised before correcting');
select pg_temp.assert_true(
  (select is_final from public.grandtour_stage_results where id = 'e5000000-0000-4000-8000-000000000003') = false,
  'stage 3 must be un-finalised (is_final=false) after correction'
);
select pg_temp.assert_true(
  (select review_status from public.grandtour_stage_results where id = 'e5000000-0000-4000-8000-000000000003') = 'correction_required',
  'stage 3 review_status must become correction_required'
);
select pg_temp.assert_true(
  (select finalised_at is null and finalised_by is null and finalisation_reason is null from public.grandtour_stage_results where id = 'e5000000-0000-4000-8000-000000000003'),
  'stage 3 finalised_at/finalised_by/finalisation_reason must be cleared'
);

\echo '=== 6. correction clears/invalidates scores safely (stage 4: finalised + scored) ==='
set local role service_role;
select public.correct_grandtour_stage_result_from_reviewed_report(
  'e4000000-0000-4000-8000-000000000004',
  pg_temp.build_swapped_lines(),
  pg_temp.build_jersey_holders(),
  pg_temp.build_reconciliation(4),
  'jersey holder was wrong after the stage was already scored',
  'correction-test-stage4-request'
) as stage4_correction_result \gset
reset role;

select pg_temp.assert_true((:'stage4_correction_result'::jsonb ->> 'status') = 'corrected', 'stage 4 correction must return status=corrected');
select pg_temp.assert_true((:'stage4_correction_result'::jsonb ->> 'scores_cleared')::int = 1, 'stage 4 must report exactly 1 score row cleared');
select pg_temp.assert_true(
  (select count(*) = 0 from public.grandtour_stage_scores where stage_id = 'e4000000-0000-4000-8000-000000000004'),
  'stage 4 must have zero score rows after correction'
);
select pg_temp.assert_true(
  (select status from public.grandtour_tips where id = 'e8000000-0000-4000-8000-000000000001') = 'corrected',
  'the affected tip must move from scored to corrected, not stay scored or revert to submitted/locked'
);
select pg_temp.assert_true(
  (select is_final from public.grandtour_stage_results where id = 'e5000000-0000-4000-8000-000000000004') = false,
  'stage 4 must be un-finalised after correction'
);

\echo '=== 7. correction writes a before/after audit log row ==='
select pg_temp.assert_true(
  (select count(*) = 1
   from public.grandtour_result_audit_log
   where stage_id = 'e4000000-0000-4000-8000-000000000004'
     and action = 'result_corrected'
     and changed_by is null
     and reason = 'jersey holder was wrong after the stage was already scored'),
  'exactly one result_corrected audit row must exist for stage 4, carrying the reason (changed_by null since called via service_role)'
);
select pg_temp.assert_true(
  (select (before_payload ->> 'score_count')::int = 1 and (after_payload ->> 'score_count')::int = 0
   from public.grandtour_result_audit_log
   where stage_id = 'e4000000-0000-4000-8000-000000000004' and action = 'result_corrected'),
  'the audit row before_payload must show score_count=1 and after_payload must show score_count=0'
);
select pg_temp.assert_true(
  (select jsonb_array_length(before_payload -> 'result_lines') = 10
   from public.grandtour_result_audit_log
   where stage_id = 'e4000000-0000-4000-8000-000000000004' and action = 'result_corrected'),
  'the audit row before_payload must include the 10 pre-correction result lines'
);

\echo '=== 8. after correction, mark_checked -> finalise -> score works again (stage 4) ==='
set local role service_role;
select public.mark_grandtour_stage_result_checked(
  'e4000000-0000-4000-8000-000000000004', 'e6000000-0000-4000-8000-000000000001', 'post-correction re-check', 'post-correction-check-request'
) as post_correction_check \gset
reset role;
select pg_temp.assert_true((:'post_correction_check'::jsonb ->> 'status') = 'checked', 'post-correction mark_checked must succeed');

set local role service_role;
select public.finalize_grandtour_stage_result(
  'e4000000-0000-4000-8000-000000000004', 'e6000000-0000-4000-8000-000000000001', 'post-correction re-finalise', 'post-correction-finalize-request'
) as post_correction_finalize \gset
reset role;
select pg_temp.assert_true((:'post_correction_finalize'::jsonb ->> 'status') = 'finalized', 'post-correction finalize must succeed');

set local role authenticated;
select pg_temp.authenticate('e6000000-0000-4000-8000-000000000001');
select public.recalculate_grandtour_stage_scores(
  'e4000000-0000-4000-8000-000000000004', 'post-correction re-score', 'post-correction-score-request'
);
reset role;

\echo '=== 9. a no_change correction (identical content) is idempotent, not an error, and does not touch review state ==='
-- Stage 2 is currently correction_required (from test 4) with the swapped
-- lines already stored - reapplying that SAME content must be a no-op.
set local role service_role;
select public.correct_grandtour_stage_result_from_reviewed_report(
  'e4000000-0000-4000-8000-000000000002',
  pg_temp.build_swapped_lines(),
  pg_temp.build_jersey_holders(),
  pg_temp.build_reconciliation(2),
  'reapplying the same reviewed report'
) as stage2_nochange_result \gset
reset role;

select pg_temp.assert_true((:'stage2_nochange_result'::jsonb ->> 'status') = 'no_change', 'reapplying identical content must return status=no_change');
select pg_temp.assert_true(
  (select count(*) = 1 from public.grandtour_result_audit_log where stage_id = 'e4000000-0000-4000-8000-000000000002' and action = 'result_corrected'),
  'a no_change reapply must not create a second result_corrected audit row for stage 2'
);
select pg_temp.assert_true(
  (select review_status from public.grandtour_stage_results where id = 'e5000000-0000-4000-8000-000000000002') = 'correction_required',
  'a no_change reapply must not alter review_status'
);

\echo '=== 10. a non-admin cannot call the correction RPC (anon or authenticated non-admin) ==='
do $$
begin
  begin
    set local role anon;
    perform public.correct_grandtour_stage_result_from_reviewed_report(
      'e4000000-0000-4000-8000-000000000002',
      pg_temp.build_swapped_lines(),
      pg_temp.build_jersey_holders(),
      pg_temp.build_reconciliation(2),
      'anon attempt'
    );
    raise exception 'anon correction call unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

do $$
begin
  begin
    set local role authenticated;
    perform pg_temp.authenticate('e6000000-0000-4000-8000-000000000002');
    perform public.correct_grandtour_stage_result_from_reviewed_report(
      'e4000000-0000-4000-8000-000000000002',
      pg_temp.build_swapped_lines(),
      pg_temp.build_jersey_holders(),
      pg_temp.build_reconciliation(2),
      'non-admin attempt'
    );
    raise exception 'non-admin authenticated correction call unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%administrator access is required%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 11. correction refuses a TTT stage ==='
do $$
begin
  begin
    set local role service_role;
    perform public.correct_grandtour_stage_result_from_reviewed_report(
      'e4000000-0000-4000-8000-000000000009',
      pg_temp.build_swapped_lines(),
      pg_temp.build_jersey_holders(),
      pg_temp.build_reconciliation(9),
      'TTT attempt'
    );
    raise exception 'TTT stage correction unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%TTT stage%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 12. correction refuses a stage with no existing result at all ==='
insert into public.grandtour_stages (id, grand_tour_id, stage_number, stage_name, stage_type, starts_at, locks_at)
values ('e4000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000001', 5, 'Correction Test Stage 5 (no result yet)', 'road', now() + interval '5 days', now() + interval '4 days');

do $$
begin
  begin
    set local role service_role;
    perform public.correct_grandtour_stage_result_from_reviewed_report(
      'e4000000-0000-4000-8000-000000000005',
      pg_temp.build_swapped_lines(),
      pg_temp.build_jersey_holders(),
      pg_temp.build_reconciliation(5),
      'attempt to correct a stage with no result'
    );
    raise exception 'correction of a stage with no existing result unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%no existing result to correct%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 13. an authenticated admin (own session, no service_role) can also call the correction RPC directly ==='
set local role authenticated;
select pg_temp.authenticate('e6000000-0000-4000-8000-000000000001');
select public.correct_grandtour_stage_result_from_reviewed_report(
  'e4000000-0000-4000-8000-000000000003',
  pg_temp.build_unchanged_lines(),
  pg_temp.build_jersey_holders(),
  pg_temp.build_reconciliation(3),
  'correcting back via the admin UI session'
) as stage3_reverted_via_admin \gset
reset role;

select pg_temp.assert_true((:'stage3_reverted_via_admin'::jsonb ->> 'status') = 'corrected', 'an authenticated cycling admin must be able to call the correction RPC directly');
select pg_temp.assert_true(
  (select count(*) = 1 from public.grandtour_result_audit_log
   where stage_id = 'e4000000-0000-4000-8000-000000000003' and action = 'result_corrected' and changed_by = 'e6000000-0000-4000-8000-000000000001'),
  'the audit row for a direct authenticated-admin correction must record changed_by as that admin'
);

select 'GrandTour correction RPC tests passed' as result;
rollback;
