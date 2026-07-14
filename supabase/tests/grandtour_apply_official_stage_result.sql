-- DB tests for public.apply_grandtour_official_stage_result(...), the
-- database-side foundation for GrandTour official-letour apply mode.
-- See docs/grandtour-apply-mode-spec.md,
-- supabase/migrations/20260709020000_grandtour_apply_official_stage_result_rpc.sql,
-- and supabase/migrations/20260714020000_grandtour_apply_ttt_individual_time_result.sql
-- (the individual_time TTT team-result-lines extension covered by tests
-- 5-10 below).
--
-- Run against local Supabase only, e.g.:
--   docker exec -i supabase_db_tipping-suite psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/grandtour_apply_official_stage_result.sql
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

-- Admin/non-admin auth.users fixtures for the authenticated-session apply
-- tests (20260714010000_grandtour_apply_authenticated_grant.sql).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('c6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'apply-rpc-test-admin@example.test', '', now(), now()),
  ('c6000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'apply-rpc-test-nonadmin@example.test', '', now(), now());

update public.user_app_memberships membership
set role = 'admin'
from public.apps app
where membership.app_id = app.id
  and membership.user_id = 'c6000000-0000-4000-8000-000000000001'
  and app.code = 'cycling';

-- Self-contained fixture: one test grand tour, five teams, nine riders,
-- four stages (road/ttt-individual_time/road/ttt-unsupported). Rider 6 is
-- deliberately left off every stage's startlist so it can drive the
-- "missing startlist rider" test. Teams C/D/E (and riders 7-9, one per
-- team) exist only to give the individual_time TTT stage (stage 2) five
-- distinct teams to rank - a real TTT always has far more than five
-- starting teams, but five is the RPC's own minimum accepted line count.
insert into public.grand_tours (id, name, year, starts_at, ends_at, preselection_locks_at)
values ('c1000000-0000-4000-8000-000000000001', 'Apply RPC Test Tour', 2099, now() + interval '2 days', now() + interval '10 days', now() + interval '1 day');

insert into public.grandtour_teams (id, grand_tour_id, name, short_name)
values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Apply Test Team A', 'ATA'),
  ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'Apply Test Team B', 'ATB'),
  ('c2000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'Apply Test Team C', 'ATC'),
  ('c2000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 'Apply Test Team D', 'ATD'),
  ('c2000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000001', 'Apply Test Team E', 'ATE');

insert into public.grandtour_riders (id, grand_tour_id, team_id, display_name, normalized_name, bib_number)
values
  ('c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Apply Rider One', 'apply rider one', 1),
  ('c3000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Apply Rider Two', 'apply rider two', 2),
  ('c3000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'Apply Rider Three', 'apply rider three', 3),
  ('c3000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'Apply Rider Four', 'apply rider four', 4),
  ('c3000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'Apply Rider Five', 'apply rider five', 5),
  ('c3000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'Apply Rider Six Off Startlist', 'apply rider six off startlist', 6),
  ('c3000000-0000-4000-8000-000000000007', 'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000003', 'Apply Rider Seven', 'apply rider seven', 7),
  ('c3000000-0000-4000-8000-000000000008', 'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000004', 'Apply Rider Eight', 'apply rider eight', 8),
  ('c3000000-0000-4000-8000-000000000009', 'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000005', 'Apply Rider Nine', 'apply rider nine', 9);

insert into public.grandtour_stages (id, grand_tour_id, stage_number, stage_name, stage_type, ttt_timing_rule, starts_at, locks_at)
values
  ('c4000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 1, 'Apply Test Road Stage 1', 'road', null, now() + interval '2 days', now() + interval '1 day'),
  ('c4000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 2, 'Apply Test Individual-Time TTT Stage', 'ttt', 'individual_time', now() + interval '3 days', now() + interval '2 days'),
  ('c4000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 3, 'Apply Test Road Stage 3', 'road', null, now() + interval '4 days', now() + interval '3 days'),
  ('c4000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 4, 'Apply Test Unsupported TTT Stage', 'ttt', 'team_time', now() + interval '5 days', now() + interval '4 days');

-- Riders 1-5, 7-9 only: rider 6 is intentionally never on any stage's startlist.
insert into public.grandtour_stage_startlists (stage_id, rider_id, team_id, status)
select stage.id, rider.id, rider.team_id, 'confirmed'
from public.grandtour_stages stage
cross join public.grandtour_riders rider
where stage.grand_tour_id = 'c1000000-0000-4000-8000-000000000001'
  and rider.grand_tour_id = stage.grand_tour_id
  and rider.id <> 'c3000000-0000-4000-8000-000000000006';

\echo '=== 1. anon cannot call the RPC ==='
do $$
begin
  begin
    set local role anon;
    perform public.apply_grandtour_official_stage_result(
      'c4000000-0000-4000-8000-000000000001',
      '[]'::jsonb,
      '{}'::jsonb
    );
    raise exception 'anon call unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

\echo '=== 2. authenticated (non-admin) cannot call the RPC either ==='
-- Since 20260714010000, `authenticated` IS EXECUTE-granted (the Vercel-safe
-- admin-session path), so a non-admin caller now reaches the function body
-- and is refused by the internal grandtour_private.is_cycling_admin()
-- guard - not by a grant-level insufficient_privilege error anymore.
do $$
begin
  begin
    set local role authenticated;
    perform pg_temp.authenticate('c6000000-0000-4000-8000-000000000002');
    perform public.apply_grandtour_official_stage_result(
      'c4000000-0000-4000-8000-000000000001',
      '[]'::jsonb,
      '{}'::jsonb
    );
    raise exception 'non-admin authenticated call unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%administrator access is required%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 3. is_final=true (p_finalize) is refused ==='
do $$
begin
  begin
    set local role service_role;
    perform public.apply_grandtour_official_stage_result(
      'c4000000-0000-4000-8000-000000000001',
      '[{"rider_id":"c3000000-0000-4000-8000-000000000001","actual_position":1}]'::jsonb,
      '{"stageNumber":1,"isTtt":false,"missingStageRecord":false,"startlistValidationPassed":true,"safeToApply":true,"matchedRiders":[{"riderId":"c3000000-0000-4000-8000-000000000001"}],"unmatchedRiders":[],"ambiguousRiders":[],"unmatchedTeams":[],"ambiguousTeams":[],"duplicateBibConflicts":[]}'::jsonb,
      '{"parserStatus":"ok","parserDriftDetected":false}'::jsonb,
      '{"provider_name":"official-letour"}'::jsonb,
      true
    );
    raise exception 'p_finalize=true unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%finalizing results%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 4. TTT stage with an unsupported ttt_timing_rule is refused, even when the payload dishonestly claims isTtt=false ==='
-- Stage 4's ttt_timing_rule is 'team_time' (the older shared-block-time
-- rule) - there is no derivation logic for it, so it must remain
-- unconditionally refused exactly like every TTT stage was before
-- 20260714020000. Stage 2 (ttt_timing_rule='individual_time') is the new,
-- now-supported case, covered by tests 5-10 below.
do $$
begin
  begin
    set local role service_role;
    perform public.apply_grandtour_official_stage_result(
      'c4000000-0000-4000-8000-000000000004',
      '[{"rider_id":"c3000000-0000-4000-8000-000000000001","actual_position":1}]'::jsonb,
      '{"stageNumber":4,"isTtt":false,"missingStageRecord":false,"startlistValidationPassed":true,"safeToApply":true,"matchedRiders":[{"riderId":"c3000000-0000-4000-8000-000000000001"}],"unmatchedRiders":[],"ambiguousRiders":[],"unmatchedTeams":[],"ambiguousTeams":[],"duplicateBibConflicts":[]}'::jsonb,
      '{"parserStatus":"ok","parserDriftDetected":false}'::jsonb,
      '{"provider_name":"official-letour"}'::jsonb,
      false
    );
    raise exception 'unsupported-timing-rule TTT stage apply unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%individual_time TTT stages are supported%' then raise; end if;
  end;
  reset role;
end;
$$;

-- Shared reconciliation payload fragment for the individual_time TTT stage
-- (stage 2) tests below: five teams (A-E), ranked exactly as
-- reconcileTeamTimeTrialResult would derive/match them, with zero blockers.
-- Inlined at each call site below rather than a psql \set variable, to
-- avoid a quoting footgun around embedded single/double quotes in JSON.

\echo '=== 5. individual_time TTT stage: p_result_lines must be empty (rider lines are not valid for a TTT stage) ==='
do $$
begin
  begin
    set local role service_role;
    perform public.apply_grandtour_official_stage_result(
      'c4000000-0000-4000-8000-000000000002',
      '[{"rider_id":"c3000000-0000-4000-8000-000000000001","actual_position":1}]'::jsonb,
      '{"stageNumber":2,"isTtt":true,"missingStageRecord":false,"startlistValidationPassed":true,"safeToApply":true,"matchedRiders":[],"unmatchedRiders":[],"ambiguousRiders":[],"unmatchedTeams":[],"ambiguousTeams":[],"duplicateBibConflicts":[],"tttTeamResult":{"blockers":[],"teams":[{"position":1,"teamId":"c2000000-0000-4000-8000-000000000001","teamName":"Apply Test Team A"},{"position":2,"teamId":"c2000000-0000-4000-8000-000000000002","teamName":"Apply Test Team B"},{"position":3,"teamId":"c2000000-0000-4000-8000-000000000003","teamName":"Apply Test Team C"},{"position":4,"teamId":"c2000000-0000-4000-8000-000000000004","teamName":"Apply Test Team D"},{"position":5,"teamId":"c2000000-0000-4000-8000-000000000005","teamName":"Apply Test Team E"}]}}'::jsonb,
      '{"parserStatus":"ok","parserDriftDetected":false}'::jsonb,
      '{"provider_name":"official-letour"}'::jsonb,
      false, null, null, '[]'::jsonb, '[]'::jsonb
    );
    raise exception 'TTT apply with non-empty p_result_lines unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%p_result_lines must be empty for a TTT stage%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 6. individual_time TTT stage: a team_id/actual_position not present in tttTeamResult.teams is refused ==='
do $$
begin
  begin
    set local role service_role;
    perform public.apply_grandtour_official_stage_result(
      'c4000000-0000-4000-8000-000000000002',
      '[]'::jsonb,
      '{"stageNumber":2,"isTtt":true,"missingStageRecord":false,"startlistValidationPassed":true,"safeToApply":true,"matchedRiders":[],"unmatchedRiders":[],"ambiguousRiders":[],"unmatchedTeams":[],"ambiguousTeams":[],"duplicateBibConflicts":[],"tttTeamResult":{"blockers":[],"teams":[{"position":1,"teamId":"c2000000-0000-4000-8000-000000000001","teamName":"Apply Test Team A"},{"position":2,"teamId":"c2000000-0000-4000-8000-000000000002","teamName":"Apply Test Team B"},{"position":3,"teamId":"c2000000-0000-4000-8000-000000000003","teamName":"Apply Test Team C"},{"position":4,"teamId":"c2000000-0000-4000-8000-000000000004","teamName":"Apply Test Team D"},{"position":5,"teamId":"c2000000-0000-4000-8000-000000000005","teamName":"Apply Test Team E"}]}}'::jsonb,
      '{"parserStatus":"ok","parserDriftDetected":false}'::jsonb,
      '{"provider_name":"official-letour"}'::jsonb,
      false, null, null, '[]'::jsonb,
      -- Team_id and actual_position are each individually unique (so the
      -- earlier duplicate-value checks don't fire first) but A and B's
      -- positions are swapped relative to what tttTeamResult.teams says
      -- (A=1, B=2) - this must be caught by the "pair not present" check.
      ('[
        {"team_id":"c2000000-0000-4000-8000-000000000001","actual_position":2},
        {"team_id":"c2000000-0000-4000-8000-000000000002","actual_position":1},
        {"team_id":"c2000000-0000-4000-8000-000000000003","actual_position":3},
        {"team_id":"c2000000-0000-4000-8000-000000000004","actual_position":4},
        {"team_id":"c2000000-0000-4000-8000-000000000005","actual_position":5}
      ]')::jsonb
    );
    raise exception 'TTT apply with a mismatched team_id/actual_position pair unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%not present in p_reconciliation.tttTeamResult.teams%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 7. individual_time TTT stage: service_role can apply a valid draft team result (5 teams) ==='
set local role service_role;
select public.apply_grandtour_official_stage_result(
  'c4000000-0000-4000-8000-000000000002',
  '[]'::jsonb,
  '{"stageNumber":2,"isTtt":true,"missingStageRecord":false,"startlistValidationPassed":true,"safeToApply":true,"matchedRiders":[],"unmatchedRiders":[],"ambiguousRiders":[],"unmatchedTeams":[],"ambiguousTeams":[],"duplicateBibConflicts":[],"tttTeamResult":{"blockers":[],"teams":[{"position":1,"teamId":"c2000000-0000-4000-8000-000000000001","teamName":"Apply Test Team A"},{"position":2,"teamId":"c2000000-0000-4000-8000-000000000002","teamName":"Apply Test Team B"},{"position":3,"teamId":"c2000000-0000-4000-8000-000000000003","teamName":"Apply Test Team C"},{"position":4,"teamId":"c2000000-0000-4000-8000-000000000004","teamName":"Apply Test Team D"},{"position":5,"teamId":"c2000000-0000-4000-8000-000000000005","teamName":"Apply Test Team E"}]}}'::jsonb,
  '{"parserStatus":"ok","parserDriftDetected":false}'::jsonb,
  '{"provider_name":"official-letour","source_url":"https://www.letour.fr/en/rankings/stage-1","fetched_at":"2026-07-14T00:00:00Z","confidence":"official"}'::jsonb,
  false,
  'apply-rpc-test-ttt-happy-path',
  'apply-rpc-test-ttt-happy-path-request',
  '[]'::jsonb,
  ('[
    {"team_id":"c2000000-0000-4000-8000-000000000001","actual_position":1},
    {"team_id":"c2000000-0000-4000-8000-000000000002","actual_position":2},
    {"team_id":"c2000000-0000-4000-8000-000000000003","actual_position":3},
    {"team_id":"c2000000-0000-4000-8000-000000000004","actual_position":4},
    {"team_id":"c2000000-0000-4000-8000-000000000005","actual_position":5}
  ]')::jsonb
) as ttt_apply_result \gset

reset role;

select pg_temp.assert_true(
  (:'ttt_apply_result'::jsonb ->> 'status') = 'applied',
  'TTT happy-path apply must return status=applied'
);
select pg_temp.assert_true(
  (:'ttt_apply_result'::jsonb ->> 'team_line_count')::int = 5,
  'TTT happy-path apply must report team_line_count=5'
);
select pg_temp.assert_true(
  (:'ttt_apply_result'::jsonb ->> 'line_count')::int = 0,
  'TTT happy-path apply must report line_count=0 (no rider lines)'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.grandtour_stage_results where stage_id = 'c4000000-0000-4000-8000-000000000002' and is_final = false),
  'stage 2 must have exactly one draft (is_final=false) result after the TTT happy-path apply'
);
select pg_temp.assert_true(
  (select count(*) = 5
   from public.grandtour_stage_team_result_lines lines
   join public.grandtour_stage_results results on results.id = lines.stage_result_id
   where results.stage_id = 'c4000000-0000-4000-8000-000000000002'),
  'stage 2 must have exactly 5 team result lines after the TTT happy-path apply'
);
select pg_temp.assert_true(
  (select count(*) = 0
   from public.grandtour_stage_result_lines lines
   join public.grandtour_stage_results results on results.id = lines.stage_result_id
   where results.stage_id = 'c4000000-0000-4000-8000-000000000002'),
  'stage 2 must have zero rider result lines after the TTT happy-path apply'
);

\echo '=== 8. individual_time TTT stage: audit run/snapshot rows were created (segment=ttt_result) ==='
select pg_temp.assert_true(
  (select count(*) = 1
   from public.grandtour_feed_import_runs
   where grand_tour_id = 'c1000000-0000-4000-8000-000000000001'
     and mode = 'apply'
     and import_status = 'applied'
     and summary ->> 'stage_id' = 'c4000000-0000-4000-8000-000000000002'),
  'exactly one grandtour_feed_import_runs row must exist for the TTT happy-path apply'
);
select pg_temp.assert_true(
  (select count(*) = 1
   from public.grandtour_feed_snapshots snapshot
   join public.grandtour_feed_import_runs run on run.id = snapshot.import_run_id
   where run.summary ->> 'stage_id' = 'c4000000-0000-4000-8000-000000000002'
     and snapshot.segment = 'ttt_result'),
  'exactly one grandtour_feed_snapshots row (segment=ttt_result) must exist for the TTT happy-path apply'
);

\echo '=== 9. individual_time TTT stage: duplicate reapply with identical content is idempotent (no new rows) ==='
set local role service_role;
select public.apply_grandtour_official_stage_result(
  'c4000000-0000-4000-8000-000000000002',
  '[]'::jsonb,
  '{"stageNumber":2,"isTtt":true,"missingStageRecord":false,"startlistValidationPassed":true,"safeToApply":true,"matchedRiders":[],"unmatchedRiders":[],"ambiguousRiders":[],"unmatchedTeams":[],"ambiguousTeams":[],"duplicateBibConflicts":[],"tttTeamResult":{"blockers":[],"teams":[{"position":1,"teamId":"c2000000-0000-4000-8000-000000000001","teamName":"Apply Test Team A"},{"position":2,"teamId":"c2000000-0000-4000-8000-000000000002","teamName":"Apply Test Team B"},{"position":3,"teamId":"c2000000-0000-4000-8000-000000000003","teamName":"Apply Test Team C"},{"position":4,"teamId":"c2000000-0000-4000-8000-000000000004","teamName":"Apply Test Team D"},{"position":5,"teamId":"c2000000-0000-4000-8000-000000000005","teamName":"Apply Test Team E"}]}}'::jsonb,
  '{"parserStatus":"ok","parserDriftDetected":false}'::jsonb,
  '{"provider_name":"official-letour"}'::jsonb,
  false,
  'apply-rpc-test-ttt-duplicate-reapply',
  null,
  '[]'::jsonb,
  ('[
    {"team_id":"c2000000-0000-4000-8000-000000000001","actual_position":1},
    {"team_id":"c2000000-0000-4000-8000-000000000002","actual_position":2},
    {"team_id":"c2000000-0000-4000-8000-000000000003","actual_position":3},
    {"team_id":"c2000000-0000-4000-8000-000000000004","actual_position":4},
    {"team_id":"c2000000-0000-4000-8000-000000000005","actual_position":5}
  ]')::jsonb
) as ttt_reapply_result \gset

reset role;

select pg_temp.assert_true(
  (:'ttt_reapply_result'::jsonb ->> 'status') = 'no_change',
  'identical TTT reapply must return status=no_change'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.grandtour_stage_results where stage_id = 'c4000000-0000-4000-8000-000000000002'),
  'identical TTT reapply must not create a second grandtour_stage_results row'
);
select pg_temp.assert_true(
  (select count(*) = 5
   from public.grandtour_stage_team_result_lines lines
   join public.grandtour_stage_results results on results.id = lines.stage_result_id
   where results.stage_id = 'c4000000-0000-4000-8000-000000000002'),
  'identical TTT reapply must not duplicate team result lines'
);

\echo '=== 10. individual_time TTT stage: a changed team result is detected and rejected, original lines untouched ==='
do $$
begin
  begin
    set local role service_role;
    perform public.apply_grandtour_official_stage_result(
      'c4000000-0000-4000-8000-000000000002',
      '[]'::jsonb,
      -- A different reconciliation payload than tests 5-9's, with A and B's
      -- derived positions swapped - so this incoming payload passes the
      -- "pair present in tttTeamResult.teams" check (it's internally
      -- consistent) and reaches the actual thing under test: the stored
      -- result (A=1, B=2) differs from this one (B=1, A=2), so apply must
      -- refuse it as a changed result, not accept it as a fresh reconcile.
      '{"stageNumber":2,"isTtt":true,"missingStageRecord":false,"startlistValidationPassed":true,"safeToApply":true,"matchedRiders":[],"unmatchedRiders":[],"ambiguousRiders":[],"unmatchedTeams":[],"ambiguousTeams":[],"duplicateBibConflicts":[],"tttTeamResult":{"blockers":[],"teams":[{"position":1,"teamId":"c2000000-0000-4000-8000-000000000002","teamName":"Apply Test Team B"},{"position":2,"teamId":"c2000000-0000-4000-8000-000000000001","teamName":"Apply Test Team A"},{"position":3,"teamId":"c2000000-0000-4000-8000-000000000003","teamName":"Apply Test Team C"},{"position":4,"teamId":"c2000000-0000-4000-8000-000000000004","teamName":"Apply Test Team D"},{"position":5,"teamId":"c2000000-0000-4000-8000-000000000005","teamName":"Apply Test Team E"}]}}'::jsonb,
      '{"parserStatus":"ok","parserDriftDetected":false}'::jsonb,
      '{"provider_name":"official-letour"}'::jsonb,
      false,
      'apply-rpc-test-ttt-changed-result',
      null,
      '[]'::jsonb,
      ('[
        {"team_id":"c2000000-0000-4000-8000-000000000002","actual_position":1},
        {"team_id":"c2000000-0000-4000-8000-000000000001","actual_position":2},
        {"team_id":"c2000000-0000-4000-8000-000000000003","actual_position":3},
        {"team_id":"c2000000-0000-4000-8000-000000000004","actual_position":4},
        {"team_id":"c2000000-0000-4000-8000-000000000005","actual_position":5}
      ]')::jsonb
    );
    raise exception 'changed TTT result unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%different draft result%' then raise; end if;
  end;
  reset role;
end;
$$;

select pg_temp.assert_true(
  (select lines.actual_position from public.grandtour_stage_team_result_lines lines
   join public.grandtour_stage_results results on results.id = lines.stage_result_id
   where results.stage_id = 'c4000000-0000-4000-8000-000000000002'
     and lines.team_id = 'c2000000-0000-4000-8000-000000000001') = 1,
  'original TTT team result lines must be unchanged after a rejected changed-result reapply'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.grandtour_stage_results where stage_id = 'c4000000-0000-4000-8000-000000000002'),
  'a rejected changed TTT result reapply must not create a second stage result row'
);

\echo '=== 11. missing startlist rider is refused atomically (no partial stage result/lines) ==='
select pg_temp.assert_true(
  (select count(*) = 0 from public.grandtour_stage_results where stage_id = 'c4000000-0000-4000-8000-000000000003'),
  'precondition: stage 3 must have no result before this test'
);

do $$
begin
  begin
    set local role service_role;
    perform public.apply_grandtour_official_stage_result(
      'c4000000-0000-4000-8000-000000000003',
      '[
        {"rider_id":"c3000000-0000-4000-8000-000000000001","actual_position":1},
        {"rider_id":"c3000000-0000-4000-8000-000000000002","actual_position":2},
        {"rider_id":"c3000000-0000-4000-8000-000000000003","actual_position":3},
        {"rider_id":"c3000000-0000-4000-8000-000000000004","actual_position":4},
        {"rider_id":"c3000000-0000-4000-8000-000000000006","actual_position":5}
      ]'::jsonb,
      -- Deliberately (and incorrectly) claims rider 6 is matched and startlist-clean,
      -- to prove the DB trigger is the real enforcement, not just the payload's say-so.
      '{"stageNumber":3,"isTtt":false,"missingStageRecord":false,"startlistValidationPassed":true,"safeToApply":true,"matchedRiders":[{"riderId":"c3000000-0000-4000-8000-000000000001"},{"riderId":"c3000000-0000-4000-8000-000000000002"},{"riderId":"c3000000-0000-4000-8000-000000000003"},{"riderId":"c3000000-0000-4000-8000-000000000004"},{"riderId":"c3000000-0000-4000-8000-000000000006"}],"unmatchedRiders":[],"ambiguousRiders":[],"unmatchedTeams":[],"ambiguousTeams":[],"duplicateBibConflicts":[]}'::jsonb,
      '{"parserStatus":"ok","parserDriftDetected":false}'::jsonb,
      '{"provider_name":"official-letour"}'::jsonb,
      false
    );
    raise exception 'result with an off-startlist rider unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%start list%' then raise; end if;
  end;
  reset role;
end;
$$;

select pg_temp.assert_true(
  (select count(*) = 0 from public.grandtour_stage_results where stage_id = 'c4000000-0000-4000-8000-000000000003'),
  'a rejected apply must leave zero grandtour_stage_results rows for that stage'
);
select pg_temp.assert_true(
  (select count(*) = 0
   from public.grandtour_stage_result_lines lines
   join public.grandtour_stage_results results on results.id = lines.stage_result_id
   where results.stage_id = 'c4000000-0000-4000-8000-000000000003'),
  'a rejected apply must leave zero grandtour_stage_result_lines rows for that stage'
);

\echo '=== 12. service_role can apply a valid draft road-stage result (stage 1) ==='
set local role service_role;
select public.apply_grandtour_official_stage_result(
  'c4000000-0000-4000-8000-000000000001',
  '[
    {"rider_id":"c3000000-0000-4000-8000-000000000001","actual_position":1},
    {"rider_id":"c3000000-0000-4000-8000-000000000002","actual_position":2},
    {"rider_id":"c3000000-0000-4000-8000-000000000003","actual_position":3},
    {"rider_id":"c3000000-0000-4000-8000-000000000004","actual_position":4},
    {"rider_id":"c3000000-0000-4000-8000-000000000005","actual_position":5}
  ]'::jsonb,
  '{"stageNumber":1,"isTtt":false,"missingStageRecord":false,"startlistValidationPassed":true,"safeToApply":true,"matchedRiders":[{"riderId":"c3000000-0000-4000-8000-000000000001"},{"riderId":"c3000000-0000-4000-8000-000000000002"},{"riderId":"c3000000-0000-4000-8000-000000000003"},{"riderId":"c3000000-0000-4000-8000-000000000004"},{"riderId":"c3000000-0000-4000-8000-000000000005"}],"unmatchedRiders":[],"ambiguousRiders":[],"unmatchedTeams":[],"ambiguousTeams":[],"duplicateBibConflicts":[]}'::jsonb,
  '{"parserStatus":"ok","parserDriftDetected":false}'::jsonb,
  '{"provider_name":"official-letour","source_url":"https://www.letour.fr/en/rankings/stage-1","fetched_at":"2026-07-09T00:00:00Z","confidence":"official"}'::jsonb,
  false,
  'apply-rpc-test-happy-path',
  'apply-rpc-test-happy-path-request'
) as apply_result \gset

reset role;

select pg_temp.assert_true(
  (:'apply_result'::jsonb ->> 'status') = 'applied',
  'happy-path apply must return status=applied'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.grandtour_stage_results where stage_id = 'c4000000-0000-4000-8000-000000000001' and is_final = false),
  'stage 1 must have exactly one draft (is_final=false) result after the happy-path apply'
);
select pg_temp.assert_true(
  (select count(*) = 5
   from public.grandtour_stage_result_lines lines
   join public.grandtour_stage_results results on results.id = lines.stage_result_id
   where results.stage_id = 'c4000000-0000-4000-8000-000000000001'),
  'stage 1 must have exactly 5 result lines after the happy-path apply'
);
select pg_temp.assert_true(
  (:'apply_result'::jsonb ->> 'team_line_count')::int = 0,
  'road-stage happy-path apply must report team_line_count=0'
);

\echo '=== 13. audit run/snapshot rows were created by the happy-path apply ==='
select pg_temp.assert_true(
  (select count(*) = 1
   from public.grandtour_feed_import_runs
   where grand_tour_id = 'c1000000-0000-4000-8000-000000000001'
     and mode = 'apply'
     and import_status = 'applied'
     and summary ->> 'stage_id' = 'c4000000-0000-4000-8000-000000000001'),
  'exactly one grandtour_feed_import_runs row must exist for the happy-path apply'
);
select pg_temp.assert_true(
  (select count(*) = 1
   from public.grandtour_feed_snapshots snapshot
   join public.grandtour_feed_import_runs run on run.id = snapshot.import_run_id
   where run.summary ->> 'stage_id' = 'c4000000-0000-4000-8000-000000000001'
     and snapshot.segment = 'stage_result'),
  'exactly one grandtour_feed_snapshots row (segment=stage_result) must exist for the happy-path apply'
);

\echo '=== 14. duplicate reapply with identical content is idempotent (no new rows) ==='
set local role service_role;
select public.apply_grandtour_official_stage_result(
  'c4000000-0000-4000-8000-000000000001',
  '[
    {"rider_id":"c3000000-0000-4000-8000-000000000001","actual_position":1},
    {"rider_id":"c3000000-0000-4000-8000-000000000002","actual_position":2},
    {"rider_id":"c3000000-0000-4000-8000-000000000003","actual_position":3},
    {"rider_id":"c3000000-0000-4000-8000-000000000004","actual_position":4},
    {"rider_id":"c3000000-0000-4000-8000-000000000005","actual_position":5}
  ]'::jsonb,
  '{"stageNumber":1,"isTtt":false,"missingStageRecord":false,"startlistValidationPassed":true,"safeToApply":true,"matchedRiders":[{"riderId":"c3000000-0000-4000-8000-000000000001"},{"riderId":"c3000000-0000-4000-8000-000000000002"},{"riderId":"c3000000-0000-4000-8000-000000000003"},{"riderId":"c3000000-0000-4000-8000-000000000004"},{"riderId":"c3000000-0000-4000-8000-000000000005"}],"unmatchedRiders":[],"ambiguousRiders":[],"unmatchedTeams":[],"ambiguousTeams":[],"duplicateBibConflicts":[]}'::jsonb,
  '{"parserStatus":"ok","parserDriftDetected":false}'::jsonb,
  '{"provider_name":"official-letour"}'::jsonb,
  false,
  'apply-rpc-test-duplicate-reapply'
) as reapply_result \gset

reset role;

select pg_temp.assert_true(
  (:'reapply_result'::jsonb ->> 'status') = 'no_change',
  'identical reapply must return status=no_change'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.grandtour_stage_results where stage_id = 'c4000000-0000-4000-8000-000000000001'),
  'identical reapply must not create a second grandtour_stage_results row'
);
select pg_temp.assert_true(
  (select count(*) = 5
   from public.grandtour_stage_result_lines lines
   join public.grandtour_stage_results results on results.id = lines.stage_result_id
   where results.stage_id = 'c4000000-0000-4000-8000-000000000001'),
  'identical reapply must not duplicate result lines'
);
select pg_temp.assert_true(
  (select count(*) = 1
   from public.grandtour_feed_import_runs
   where summary ->> 'stage_id' = 'c4000000-0000-4000-8000-000000000001'),
  'identical reapply (no_change) must not create a second import run row'
);

\echo '=== 15. a changed official result is detected and rejected, original lines untouched ==='
do $$
begin
  begin
    set local role service_role;
    perform public.apply_grandtour_official_stage_result(
      'c4000000-0000-4000-8000-000000000001',
      '[
        {"rider_id":"c3000000-0000-4000-8000-000000000001","actual_position":1},
        {"rider_id":"c3000000-0000-4000-8000-000000000002","actual_position":2},
        {"rider_id":"c3000000-0000-4000-8000-000000000003","actual_position":3},
        {"rider_id":"c3000000-0000-4000-8000-000000000005","actual_position":4},
        {"rider_id":"c3000000-0000-4000-8000-000000000004","actual_position":5}
      ]'::jsonb,
      '{"stageNumber":1,"isTtt":false,"missingStageRecord":false,"startlistValidationPassed":true,"safeToApply":true,"matchedRiders":[{"riderId":"c3000000-0000-4000-8000-000000000001"},{"riderId":"c3000000-0000-4000-8000-000000000002"},{"riderId":"c3000000-0000-4000-8000-000000000003"},{"riderId":"c3000000-0000-4000-8000-000000000004"},{"riderId":"c3000000-0000-4000-8000-000000000005"}],"unmatchedRiders":[],"ambiguousRiders":[],"unmatchedTeams":[],"ambiguousTeams":[],"duplicateBibConflicts":[]}'::jsonb,
      '{"parserStatus":"ok","parserDriftDetected":false}'::jsonb,
      '{"provider_name":"official-letour"}'::jsonb,
      false,
      'apply-rpc-test-changed-result'
    );
    raise exception 'changed result unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%different draft result%' then raise; end if;
  end;
  reset role;
end;
$$;

select pg_temp.assert_true(
  (select lines.actual_position from public.grandtour_stage_result_lines lines
   join public.grandtour_stage_results results on results.id = lines.stage_result_id
   where results.stage_id = 'c4000000-0000-4000-8000-000000000001'
     and lines.rider_id = 'c3000000-0000-4000-8000-000000000004') = 4,
  'original result lines must be unchanged after a rejected changed-result reapply'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.grandtour_stage_results where stage_id = 'c4000000-0000-4000-8000-000000000001'),
  'a rejected changed-result reapply must not create a second stage result row'
);

-- Tests 16-17 cover the Vercel-safe direct-authenticated-session path added
-- by 20260714010000_grandtour_apply_authenticated_grant.sql, mirroring
-- 20260710060000's tests 14/17 for mark-checked/finalise.

\echo '=== 16. an authenticated admin (own session, no service_role) CAN apply a valid draft result directly ==='
set local role authenticated;
select pg_temp.authenticate('c6000000-0000-4000-8000-000000000001');
select public.apply_grandtour_official_stage_result(
  'c4000000-0000-4000-8000-000000000003',
  '[
    {"rider_id":"c3000000-0000-4000-8000-000000000001","actual_position":1},
    {"rider_id":"c3000000-0000-4000-8000-000000000002","actual_position":2},
    {"rider_id":"c3000000-0000-4000-8000-000000000003","actual_position":3},
    {"rider_id":"c3000000-0000-4000-8000-000000000004","actual_position":4},
    {"rider_id":"c3000000-0000-4000-8000-000000000005","actual_position":5}
  ]'::jsonb,
  '{"stageNumber":3,"isTtt":false,"missingStageRecord":false,"startlistValidationPassed":true,"safeToApply":true,"matchedRiders":[{"riderId":"c3000000-0000-4000-8000-000000000001"},{"riderId":"c3000000-0000-4000-8000-000000000002"},{"riderId":"c3000000-0000-4000-8000-000000000003"},{"riderId":"c3000000-0000-4000-8000-000000000004"},{"riderId":"c3000000-0000-4000-8000-000000000005"}],"unmatchedRiders":[],"ambiguousRiders":[],"unmatchedTeams":[],"ambiguousTeams":[],"duplicateBibConflicts":[]}'::jsonb,
  '{"parserStatus":"ok","parserDriftDetected":false}'::jsonb,
  '{"provider_name":"official-letour","source_url":"https://www.letour.fr/en/rankings/stage-3","fetched_at":"2026-07-09T00:00:00Z","confidence":"official"}'::jsonb,
  false,
  'apply-rpc-test-admin-session-happy-path',
  'apply-rpc-test-admin-session-request'
) as admin_apply_result \gset
reset role;

select pg_temp.assert_true(
  (:'admin_apply_result'::jsonb ->> 'status') = 'applied',
  'an authenticated admin session must be able to apply a valid draft result directly, status=applied'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.grandtour_stage_results where stage_id = 'c4000000-0000-4000-8000-000000000003' and is_final = false),
  'stage 3 must have exactly one draft result after the admin-session apply'
);
select pg_temp.assert_true(
  (select count(*) = 5
   from public.grandtour_stage_result_lines lines
   join public.grandtour_stage_results results on results.id = lines.stage_result_id
   where results.stage_id = 'c4000000-0000-4000-8000-000000000003'),
  'stage 3 must have exactly 5 result lines after the admin-session apply'
);

\echo '=== 17. anon still cannot call the RPC after the authenticated grant ==='
do $$
begin
  begin
    set local role anon;
    perform public.apply_grandtour_official_stage_result(
      'c4000000-0000-4000-8000-000000000003',
      '[]'::jsonb,
      '{}'::jsonb
    );
    raise exception 'anon call unexpectedly succeeded after the authenticated grant';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

select 'GrandTour apply_grandtour_official_stage_result RPC tests passed' as result;
rollback;
