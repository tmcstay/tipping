-- DB tests for the admin review workflow:
--   public.mark_grandtour_stage_result_checked(...)
--   public.finalize_grandtour_stage_result(...)  [4-arg, review_status-gated]
-- See supabase/migrations/20260710020000_grandtour_stage_result_review_workflow_schema.sql,
-- supabase/migrations/20260710030000_grandtour_admin_review_workflow_rpc.sql,
-- supabase/migrations/20260710060000_grandtour_admin_check_finalise_authenticated_grants.sql
-- (adds the internal grandtour_private.is_cycling_admin() guard and the
-- `authenticated` EXECUTE grant that let these be called directly from the
-- Vercel-safe admin UI, not only via service_role), and
-- supabase/migrations/20260714030000_grandtour_ttt_individual_time_admin_review_workflow.sql
-- (the individual_time TTT extension covered by tests 20-24 below, which
-- also exercise the full apply-was-already-done -> mark-checked ->
-- finalize -> tip -> score handoff for a real TTT stage end to end).
--
-- Run against local Supabase only, e.g.:
--   docker exec -i supabase_db_tipping-suite psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/grandtour_finalize_stage_result.sql
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

-- Self-contained fixture: one test grand tour, one team, ten riders, one
-- road stage (with a draft/imported result + 4 jersey holders,
-- Stage-2-shaped), one road stage with no result at all, one
-- individual_time TTT stage (with a real 10-team draft result, used by
-- tests 20-24 for the full mark-checked -> finalize -> tip -> score
-- rehearsal), and one unsupported-timing-rule TTT stage (used by test 8).
-- One admin user is provisioned so the post-finalize scoring test (13) can
-- call recalculate_grandtour_stage_scores(), which is security invoker and
-- requires grandtour_private.is_cycling_admin() = true.
insert into public.grand_tours (id, name, year, starts_at, ends_at, preselection_locks_at)
values ('d1000000-0000-4000-8000-000000000001', 'Finalize RPC Test Tour', 2099, now() + interval '2 days', now() + interval '10 days', now() + interval '1 day');

insert into public.grandtour_teams (id, grand_tour_id, name, short_name)
values ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Finalize Test Team', 'FTT');

insert into public.grandtour_riders (id, grand_tour_id, team_id, display_name, normalized_name, bib_number)
select
  ('d3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'd1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'Finalize Rider ' || n,
  'finalize rider ' || n,
  n
from generate_series(1, 10) n;

-- Nine more teams (ten total, including the one above), each with one
-- rider, so stage 9 (the individual_time TTT stage below) has a real
-- multi-team roster to derive a 10-team result from - a real TTT always
-- has far more than 10 starting teams, but ten is the RPC's own minimum
-- accepted line count.
insert into public.grandtour_teams (id, grand_tour_id, name, short_name)
select
  ('d2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'd1000000-0000-4000-8000-000000000001',
  'Finalize Test Team ' || n,
  'FTT' || n
from generate_series(2, 10) n;

insert into public.grandtour_riders (id, grand_tour_id, team_id, display_name, normalized_name, bib_number)
select
  ('d3000000-0000-4000-8000-' || lpad((n + 10)::text, 12, '0'))::uuid,
  'd1000000-0000-4000-8000-000000000001',
  ('d2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'Finalize TTT Rider ' || n,
  'finalize ttt rider ' || n,
  n + 10
from generate_series(2, 10) n;

insert into public.grandtour_stages (id, grand_tour_id, stage_number, stage_name, stage_type, ttt_timing_rule, starts_at, locks_at)
values
  ('d4000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 2, 'Finalize Test Stage 2', 'road', null, now() + interval '2 days', now() + interval '1 day'),
  ('d4000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 3, 'Finalize Test Stage 3 (no result yet)', 'road', null, now() + interval '3 days', now() + interval '2 days'),
  ('d4000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000001', 5, 'Finalize Test Stage 5 (authenticated-admin direct-call path)', 'road', null, now() + interval '5 days', now() + interval '4 days'),
  ('d4000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000001', 9, 'Finalize Test Individual-Time TTT Stage', 'ttt', 'individual_time', now() + interval '3 days', now() + interval '2 days'),
  ('d4000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000001', 11, 'Finalize Test Unsupported TTT Stage', 'ttt', 'team_time', now() + interval '6 days', now() + interval '5 days');

insert into public.grandtour_stage_startlists (stage_id, rider_id, team_id, status)
select stage.id, rider.id, rider.team_id, 'confirmed'
from public.grandtour_stages stage
cross join public.grandtour_riders rider
where stage.grand_tour_id = 'd1000000-0000-4000-8000-000000000001'
  and rider.grand_tour_id = stage.grand_tour_id;

-- Stage 2's draft/imported result: exactly 10 result lines (Stage-2-shaped).
insert into public.grandtour_stage_results (id, stage_id, is_final, review_status, source_mode)
values ('d5000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000002', false, 'imported', 'official_feed');

insert into public.grandtour_stage_result_lines (stage_result_id, rider_id, actual_position)
select 'd5000000-0000-4000-8000-000000000001', rider.id, rider.bib_number
from public.grandtour_riders rider
where rider.grand_tour_id = 'd1000000-0000-4000-8000-000000000001'
  and rider.team_id = 'd2000000-0000-4000-8000-000000000001';

insert into public.grandtour_stage_jersey_holders (stage_id, jersey_type, rider_id)
values
  ('d4000000-0000-4000-8000-000000000002', 'yellow', 'd3000000-0000-4000-8000-000000000001'),
  ('d4000000-0000-4000-8000-000000000002', 'green', 'd3000000-0000-4000-8000-000000000002'),
  ('d4000000-0000-4000-8000-000000000002', 'kom', 'd3000000-0000-4000-8000-000000000003'),
  ('d4000000-0000-4000-8000-000000000002', 'white', 'd3000000-0000-4000-8000-000000000004');

-- Stage 5's draft/imported result: a second, independent Stage-2-shaped
-- fixture used only by the "authenticated admin can call directly (no
-- service_role)" tests below, so it doesn't disturb stage 2's own
-- audit-log row-count assertions.
insert into public.grandtour_stage_results (id, stage_id, is_final, review_status, source_mode)
values ('d5000000-0000-4000-8000-000000000005', 'd4000000-0000-4000-8000-000000000005', false, 'imported', 'official_feed');

insert into public.grandtour_stage_result_lines (stage_result_id, rider_id, actual_position)
select 'd5000000-0000-4000-8000-000000000005', rider.id, rider.bib_number
from public.grandtour_riders rider
where rider.grand_tour_id = 'd1000000-0000-4000-8000-000000000001'
  and rider.team_id = 'd2000000-0000-4000-8000-000000000001';

insert into public.grandtour_stage_jersey_holders (stage_id, jersey_type, rider_id)
values
  ('d4000000-0000-4000-8000-000000000005', 'yellow', 'd3000000-0000-4000-8000-000000000001'),
  ('d4000000-0000-4000-8000-000000000005', 'green', 'd3000000-0000-4000-8000-000000000002'),
  ('d4000000-0000-4000-8000-000000000005', 'kom', 'd3000000-0000-4000-8000-000000000003'),
  ('d4000000-0000-4000-8000-000000000005', 'white', 'd3000000-0000-4000-8000-000000000004');

-- Stage 9's draft/imported result: a real 10-team result (positions 1-10,
-- team d2...0001 finishing last at position 10 - deliberately not
-- alphabetical/ID order, so the scoring test below genuinely exercises
-- exact/partial/miss cases rather than a suspiciously tidy 1:1 mapping).
insert into public.grandtour_stage_results (id, stage_id, is_final, review_status, source_mode)
values ('d5000000-0000-4000-8000-000000000009', 'd4000000-0000-4000-8000-000000000009', false, 'imported', 'official_feed');

insert into public.grandtour_stage_team_result_lines (stage_result_id, team_id, actual_position)
values
  ('d5000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000002', 1),
  ('d5000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000003', 2),
  ('d5000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000004', 3),
  ('d5000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000005', 4),
  ('d5000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000006', 5),
  ('d5000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000007', 6),
  ('d5000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000008', 7),
  ('d5000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000009', 8),
  ('d5000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000010', 9),
  ('d5000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000001', 10);

insert into public.grandtour_stage_jersey_holders (stage_id, jersey_type, rider_id)
values
  ('d4000000-0000-4000-8000-000000000009', 'yellow', 'd3000000-0000-4000-8000-000000000001'),
  ('d4000000-0000-4000-8000-000000000009', 'green', 'd3000000-0000-4000-8000-000000000002'),
  ('d4000000-0000-4000-8000-000000000009', 'kom', 'd3000000-0000-4000-8000-000000000003'),
  ('d4000000-0000-4000-8000-000000000009', 'white', 'd3000000-0000-4000-8000-000000000004');

-- Admin user for the post-finalization scoring test and the
-- authenticated-admin direct-call tests below.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('d6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finalize-admin@example.test', '', now(), now());

update public.user_app_memberships membership
set role = 'admin'
from public.apps app
where membership.app_id = app.id
  and membership.user_id = 'd6000000-0000-4000-8000-000000000001'
  and app.code = 'cycling';

-- Non-admin authenticated user (auth.users' handle_new_user trigger
-- auto-creates a role='user' membership on the cycling app for this row -
-- deliberately left unpromoted, so this user proves "authenticated but not
-- an admin" is still refused).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('d6000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finalize-nonadmin@example.test', '', now(), now());

\echo '=== 1. anon cannot call mark_grandtour_stage_result_checked or finalize_grandtour_stage_result ==='
do $$
begin
  begin
    set local role anon;
    perform public.mark_grandtour_stage_result_checked('d4000000-0000-4000-8000-000000000002', 'd6000000-0000-4000-8000-000000000001');
    raise exception 'anon mark_checked call unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
begin
  begin
    set local role anon;
    perform public.finalize_grandtour_stage_result('d4000000-0000-4000-8000-000000000002', 'd6000000-0000-4000-8000-000000000001');
    raise exception 'anon finalize call unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

\echo '=== 2. cannot mark checked without a draft result at all ==='
do $$
begin
  begin
    set local role service_role;
    perform public.mark_grandtour_stage_result_checked('d4000000-0000-4000-8000-000000000003', 'd6000000-0000-4000-8000-000000000001');
    raise exception 'mark_checked of a stage with no draft result unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%has no draft result%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 3. cannot mark checked without exactly 10 result lines ==='
-- A PL/pgSQL EXCEPTION handler implicitly rolls back to a savepoint taken
-- at the start of its block, so this deliberate DELETE must be a separate
-- top-level statement — not inside the same DO block that catches the
-- expected error, or the DELETE itself would be rolled back too.
delete from public.grandtour_stage_result_lines
where stage_result_id = 'd5000000-0000-4000-8000-000000000001'
  and rider_id = 'd3000000-0000-4000-8000-000000000010';

do $$
begin
  begin
    set local role service_role;
    perform public.mark_grandtour_stage_result_checked('d4000000-0000-4000-8000-000000000002', 'd6000000-0000-4000-8000-000000000001');
    raise exception 'mark_checked with 9 result lines unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%exactly 10 are required%' then raise; end if;
  end;
  reset role;
end;
$$;

insert into public.grandtour_stage_result_lines (stage_result_id, rider_id, actual_position)
values ('d5000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000010', 10);

\echo '=== 4. cannot mark checked without exactly 4 jersey holders ==='
delete from public.grandtour_stage_jersey_holders
where stage_id = 'd4000000-0000-4000-8000-000000000002'
  and jersey_type = 'white';

do $$
begin
  begin
    set local role service_role;
    perform public.mark_grandtour_stage_result_checked('d4000000-0000-4000-8000-000000000002', 'd6000000-0000-4000-8000-000000000001');
    raise exception 'mark_checked with 3 jersey holders unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%jersey holder%exactly 4%' then raise; end if;
  end;
  reset role;
end;
$$;

insert into public.grandtour_stage_jersey_holders (stage_id, jersey_type, rider_id)
values ('d4000000-0000-4000-8000-000000000002', 'white', 'd3000000-0000-4000-8000-000000000004');

\echo '=== 5. cannot finalize before admin_checked (review_status is still imported) ==='
do $$
begin
  begin
    set local role service_role;
    perform public.finalize_grandtour_stage_result('d4000000-0000-4000-8000-000000000002', 'd6000000-0000-4000-8000-000000000001');
    raise exception 'finalize before admin_checked unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%not admin_checked%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 6. mark_grandtour_stage_result_checked works on a valid draft (10 lines + 4 jersey holders) ==='
set local role service_role;
select public.mark_grandtour_stage_result_checked(
  'd4000000-0000-4000-8000-000000000002',
  'd6000000-0000-4000-8000-000000000001',
  'looks correct against letour.fr',
  'mark-checked-test-request'
) as check_result \gset

reset role;

select pg_temp.assert_true(
  (:'check_result'::jsonb ->> 'status') = 'checked',
  'mark_grandtour_stage_result_checked must return status=checked'
);
select pg_temp.assert_true(
  (select review_status from public.grandtour_stage_results where id = 'd5000000-0000-4000-8000-000000000001') = 'admin_checked',
  'review_status must be admin_checked after mark_grandtour_stage_result_checked'
);
select pg_temp.assert_true(
  (select admin_checked_by from public.grandtour_stage_results where id = 'd5000000-0000-4000-8000-000000000001') = 'd6000000-0000-4000-8000-000000000001',
  'admin_checked_by must be recorded'
);
select pg_temp.assert_true(
  (select admin_check_note from public.grandtour_stage_results where id = 'd5000000-0000-4000-8000-000000000001') = 'looks correct against letour.fr',
  'admin_check_note must be recorded'
);
select pg_temp.assert_true(
  (select is_final from public.grandtour_stage_results where id = 'd5000000-0000-4000-8000-000000000001') = false,
  'mark_grandtour_stage_result_checked must never set is_final'
);
select pg_temp.assert_true(
  (select count(*) = 0 from public.grandtour_stage_scores where stage_id = 'd4000000-0000-4000-8000-000000000002'),
  'mark_grandtour_stage_result_checked must never create score rows'
);

\echo '=== 7. audit log: admin_checked action was written ==='
select pg_temp.assert_true(
  (select count(*) = 1
   from public.grandtour_result_audit_log
   where stage_id = 'd4000000-0000-4000-8000-000000000002'
     and action = 'admin_checked'
     and changed_by = 'd6000000-0000-4000-8000-000000000001'
     and reason = 'looks correct against letour.fr'),
  'exactly one admin_checked audit row must exist, carrying p_checked_by/p_note'
);

\echo '=== 8. cannot finalize an unsupported-timing-rule TTT stage ==='
-- Stage 11's ttt_timing_rule is 'team_time' (the older shared-block-time
-- rule) - there is no derivation logic for it, so it must remain
-- unconditionally refused exactly like every TTT stage was before
-- 20260714030000. Stage 9 (ttt_timing_rule='individual_time') is the
-- now-supported case, covered by tests 20-24 below.
do $$
begin
  begin
    set local role service_role;
    perform public.finalize_grandtour_stage_result('d4000000-0000-4000-8000-000000000011', 'd6000000-0000-4000-8000-000000000001');
    raise exception 'unsupported-timing-rule TTT stage finalize unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%individual_time TTT stages are supported%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 9. finalize works after admin_checked ==='
set local role service_role;
select public.finalize_grandtour_stage_result(
  'd4000000-0000-4000-8000-000000000002',
  'd6000000-0000-4000-8000-000000000001',
  'finalize-rpc-test-happy-path',
  'finalize-rpc-test-happy-path-request'
) as finalize_result \gset

reset role;

select pg_temp.assert_true(
  (:'finalize_result'::jsonb ->> 'status') = 'finalized',
  'happy-path finalize must return status=finalized'
);
select pg_temp.assert_true(
  (select is_final from public.grandtour_stage_results where id = 'd5000000-0000-4000-8000-000000000001') = true,
  'stage 2''s result must be is_final=true after finalize'
);
select pg_temp.assert_true(
  (select review_status from public.grandtour_stage_results where id = 'd5000000-0000-4000-8000-000000000001') = 'finalised',
  'review_status must be finalised after finalize'
);
select pg_temp.assert_true(
  (select finalised_by from public.grandtour_stage_results where id = 'd5000000-0000-4000-8000-000000000001') = 'd6000000-0000-4000-8000-000000000001',
  'finalised_by must be recorded'
);
select pg_temp.assert_true(
  (select count(*) = 10 from public.grandtour_stage_result_lines where stage_result_id = 'd5000000-0000-4000-8000-000000000001'),
  'finalize must not have changed the result-line count (still 10)'
);
select pg_temp.assert_true(
  (select count(*) = 4 from public.grandtour_stage_jersey_holders where stage_id = 'd4000000-0000-4000-8000-000000000002'),
  'finalize must not have changed the jersey-holder count (still 4)'
);

\echo '=== 10. finalize does not create score rows ==='
select pg_temp.assert_true(
  (select count(*) = 0 from public.grandtour_stage_scores where stage_id = 'd4000000-0000-4000-8000-000000000002'),
  'finalize must not create any grandtour_stage_scores rows'
);

\echo '=== 11. audit log: finalised action was written ==='
select pg_temp.assert_true(
  (select count(*) = 1
   from public.grandtour_result_audit_log
   where stage_id = 'd4000000-0000-4000-8000-000000000002'
     and action = 'finalised'
     and changed_by = 'd6000000-0000-4000-8000-000000000001'
     and reason = 'finalize-rpc-test-happy-path'),
  'exactly one finalised audit row must exist, carrying p_finalized_by/p_reason'
);

\echo '=== 12. re-finalizing an already-final result returns no_change, not an error ==='
set local role service_role;
select public.finalize_grandtour_stage_result('d4000000-0000-4000-8000-000000000002', 'd6000000-0000-4000-8000-000000000001') as reapply_result \gset
reset role;

select pg_temp.assert_true(
  (:'reapply_result'::jsonb ->> 'status') = 'no_change',
  'finalizing an already-final result must return status=no_change'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.grandtour_result_audit_log where stage_id = 'd4000000-0000-4000-8000-000000000002' and action = 'finalised'),
  'a no_change re-finalize must not create a second finalised audit row'
);

\echo '=== 13. scoring RPC works after finalize (finalize -> score handoff) ==='
set local role authenticated;
select pg_temp.authenticate('d6000000-0000-4000-8000-000000000001');
select public.recalculate_grandtour_stage_scores(
  'd4000000-0000-4000-8000-000000000002',
  'finalize-rpc-test-post-finalize-scoring',
  'finalize-rpc-test-post-finalize-scoring-request'
);
reset role;

-- Tests 14-19 cover the Vercel-safe direct-authenticated-session path added
-- by 20260710060000_grandtour_admin_check_finalise_authenticated_grants.sql:
-- both RPCs are now EXECUTE-granted to `authenticated`, gated internally by
-- grandtour_private.is_cycling_admin() rather than the grant alone.

\echo '=== 14. authenticated non-admin cannot call mark_grandtour_stage_result_checked ==='
do $$
begin
  begin
    set local role authenticated;
    perform pg_temp.authenticate('d6000000-0000-4000-8000-000000000002');
    perform public.mark_grandtour_stage_result_checked('d4000000-0000-4000-8000-000000000005', 'd6000000-0000-4000-8000-000000000002');
    raise exception 'non-admin authenticated mark_checked call unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%administrator access is required%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 15. authenticated non-admin cannot call finalize_grandtour_stage_result ==='
do $$
begin
  begin
    set local role authenticated;
    perform pg_temp.authenticate('d6000000-0000-4000-8000-000000000002');
    perform public.finalize_grandtour_stage_result('d4000000-0000-4000-8000-000000000005', 'd6000000-0000-4000-8000-000000000002');
    raise exception 'non-admin authenticated finalize call unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%administrator access is required%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 16. authenticated non-admin cannot call recalculate_grandtour_stage_scores either (scoring still requires authenticated admin) ==='
do $$
begin
  begin
    set local role authenticated;
    perform pg_temp.authenticate('d6000000-0000-4000-8000-000000000002');
    perform public.recalculate_grandtour_stage_scores('d4000000-0000-4000-8000-000000000002', 'non-admin score attempt');
    raise exception 'non-admin authenticated score call unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%administrator access is required%' then raise; end if;
  end;
  reset role;
end;
$$;

\echo '=== 17. an authenticated admin (own session, no service_role) CAN call mark_grandtour_stage_result_checked directly ==='
set local role authenticated;
select pg_temp.authenticate('d6000000-0000-4000-8000-000000000001');
select public.mark_grandtour_stage_result_checked(
  'd4000000-0000-4000-8000-000000000005',
  'd6000000-0000-4000-8000-000000000001',
  'checked via the admin UI session, not service_role',
  'stage5-direct-mark-checked-request'
) as stage5_check_result \gset
reset role;

select pg_temp.assert_true(
  (:'stage5_check_result'::jsonb ->> 'status') = 'checked',
  'an authenticated cycling admin must be able to call mark_grandtour_stage_result_checked directly'
);
select pg_temp.assert_true(
  (select review_status from public.grandtour_stage_results where id = 'd5000000-0000-4000-8000-000000000005') = 'admin_checked',
  'stage 5 review_status must be admin_checked after the direct authenticated-admin call'
);

\echo '=== 18. an authenticated admin (own session, no service_role) CAN call finalize_grandtour_stage_result directly ==='
set local role authenticated;
select pg_temp.authenticate('d6000000-0000-4000-8000-000000000001');
select public.finalize_grandtour_stage_result(
  'd4000000-0000-4000-8000-000000000005',
  'd6000000-0000-4000-8000-000000000001',
  'finalised via the admin UI session, not service_role',
  'stage5-direct-finalize-request'
) as stage5_finalize_result \gset
reset role;

select pg_temp.assert_true(
  (:'stage5_finalize_result'::jsonb ->> 'status') = 'finalized',
  'an authenticated cycling admin must be able to call finalize_grandtour_stage_result directly'
);
select pg_temp.assert_true(
  (select is_final from public.grandtour_stage_results where id = 'd5000000-0000-4000-8000-000000000005') = true,
  'stage 5 must be is_final=true after the direct authenticated-admin finalize call'
);
select pg_temp.assert_true(
  (select review_status from public.grandtour_stage_results where id = 'd5000000-0000-4000-8000-000000000005') = 'finalised',
  'stage 5 review_status must be finalised after the direct authenticated-admin finalize call'
);

\echo '=== 19. scoring via the same authenticated-admin session works for stage 5 too ==='
set local role authenticated;
select pg_temp.authenticate('d6000000-0000-4000-8000-000000000001');
select public.recalculate_grandtour_stage_scores(
  'd4000000-0000-4000-8000-000000000005',
  'stage5-direct-score',
  'stage5-direct-score-request'
) as stage5_score_result \gset
reset role;

select pg_temp.assert_true(
  :'stage5_score_result' is not null,
  'recalculate_grandtour_stage_scores must succeed for an authenticated cycling admin on a finalised stage'
);

-- Tests 20-24: the full individual_time TTT rehearsal (apply already done
-- in the fixture setup above, mirroring a real applied draft) ->
-- mark-checked -> finalize -> a real user tip with team picks -> score,
-- verifying the actual computed points, not just that scoring "succeeded".

\echo '=== 20. mark_grandtour_stage_result_checked works on a valid individual_time TTT draft (10 team lines + 4 jersey holders) ==='
set local role service_role;
select public.mark_grandtour_stage_result_checked(
  'd4000000-0000-4000-8000-000000000009',
  'd6000000-0000-4000-8000-000000000001',
  'TTT team result looks correct against letour.fr',
  'ttt-mark-checked-test-request'
) as ttt_check_result \gset
reset role;

select pg_temp.assert_true(
  (:'ttt_check_result'::jsonb ->> 'status') = 'checked',
  'mark_grandtour_stage_result_checked must return status=checked for an individual_time TTT stage'
);
select pg_temp.assert_true(
  (select review_status from public.grandtour_stage_results where id = 'd5000000-0000-4000-8000-000000000009') = 'admin_checked',
  'stage 9 review_status must be admin_checked'
);

\echo '=== 21. finalize_grandtour_stage_result works on the checked individual_time TTT stage ==='
set local role service_role;
select public.finalize_grandtour_stage_result(
  'd4000000-0000-4000-8000-000000000009',
  'd6000000-0000-4000-8000-000000000001',
  'ttt-finalize-test-happy-path',
  'ttt-finalize-test-happy-path-request'
) as ttt_finalize_result \gset
reset role;

select pg_temp.assert_true(
  (:'ttt_finalize_result'::jsonb ->> 'status') = 'finalized',
  'finalize must return status=finalized for an individual_time TTT stage'
);
select pg_temp.assert_true(
  (select is_final from public.grandtour_stage_results where id = 'd5000000-0000-4000-8000-000000000009') = true,
  'stage 9''s result must be is_final=true after finalize'
);
select pg_temp.assert_true(
  (select count(*) = 10 from public.grandtour_stage_team_result_lines where stage_result_id = 'd5000000-0000-4000-8000-000000000009'),
  'finalize must not have changed the team-result-line count (still 10)'
);

\echo '=== 22. a real user submits a TTT tip (team top-5 + jersey picks) against the now-finalised stage ==='
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('d6000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ttt-tipper@example.test', '', now(), now());

insert into public.competitions (id, app_id, competition_key, name, sport_type, is_active, is_public)
select 'd7000000-0000-4000-8000-000000000001', app.id, 'ttt-finalize-test-competition', 'TTT Finalize Test League', 'cycling', true, false
from public.apps app
where app.code = 'cycling';

insert into public.grandtour_competitions (id, grand_tour_id, competition_id, name, is_public, allow_preselection, allow_daily)
values ('d8000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000001', 'TTT Finalize Test League', false, true, true);

insert into public.competition_memberships (competition_id, user_id, role, status, joined_at)
values ('d7000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000003', 'player', 'active', now());

set local role authenticated;
select pg_temp.authenticate('d6000000-0000-4000-8000-000000000003');

-- Deliberately not a tidy 1:1 mapping against the actual result (team
-- d2...0002 at actual position 1, d2...0003 at actual position 2, etc. -
-- see the stage 9 fixture above): position 1 is predicted as the team
-- that actually finished 2nd, and position 2 as the team that actually
-- finished 1st (both still genuinely top-5, both "wrong slot" - flat 3
-- points each, and neither triggers the separate winning-team bonus since
-- neither is predicted at position 1); position 3 predicts the team that
-- actually finished 3rd exactly (6 points); positions 4-5 predict teams
-- that actually finished 8th and 9th (outside the top 5 - 0 points each).
-- All 4 jersey picks are exact.
select public.save_grandtour_tip_draft(
  'd8000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000009',
  'daily',
  'stage',
  '[
    {"selection_type":"stage_top_5","team_id":"d2000000-0000-4000-8000-000000000003","predicted_position":1},
    {"selection_type":"stage_top_5","team_id":"d2000000-0000-4000-8000-000000000002","predicted_position":2},
    {"selection_type":"stage_top_5","team_id":"d2000000-0000-4000-8000-000000000004","predicted_position":3},
    {"selection_type":"stage_top_5","team_id":"d2000000-0000-4000-8000-000000000009","predicted_position":4},
    {"selection_type":"stage_top_5","team_id":"d2000000-0000-4000-8000-000000000010","predicted_position":5},
    {"selection_type":"yellow_holder","rider_id":"d3000000-0000-4000-8000-000000000001"},
    {"selection_type":"green_holder","rider_id":"d3000000-0000-4000-8000-000000000002"},
    {"selection_type":"kom_holder","rider_id":"d3000000-0000-4000-8000-000000000003"},
    {"selection_type":"white_holder","rider_id":"d3000000-0000-4000-8000-000000000004"}
  ]'::jsonb,
  'ttt-tip-draft'
) as ttt_tip_id \gset

-- submit_grandtour_tip returns the full public.grandtour_tips row (a
-- composite type), not jsonb - checked via a direct table query below,
-- same convention as supabase/tests/canonical_grandtour_tipping.sql.
select public.submit_grandtour_tip(:'ttt_tip_id'::uuid, 'ttt-tip-submit');
reset role;

select pg_temp.assert_true(
  (select tip.status = 'submitted' and tip.submitted_at is not null
   from public.grandtour_tips tip
   where tip.id = :'ttt_tip_id'::uuid),
  'the TTT tip must submit successfully once it has 5 team picks and 4 jersey picks'
);

\echo '=== 23. recalculate_grandtour_stage_scores computes the correct TTT points (exact/partial/miss) ==='
set local role authenticated;
select pg_temp.authenticate('d6000000-0000-4000-8000-000000000001');
select public.recalculate_grandtour_stage_scores(
  'd4000000-0000-4000-8000-000000000009',
  'ttt-finalize-test-scoring',
  'ttt-finalize-test-scoring-request'
);
reset role;

-- The real TTT scoring rule (20260703041335_implement_grandtour_ttt_scoring.sql,
-- which supersedes an earlier draft version of this function from
-- 20260703025324) is a flat scale, NOT the rider path's tiered 10/8/6/4/2:
-- an exact position match is 6 points, any other team that's still
-- genuinely in the real top 5 is a flat 3 points, and a team outside the
-- top 5 (or with no result line at all) is 0 - plus a separate "winning
-- team bonus" of 4, awarded independently whenever predicted_position=1
-- correctly names the actual position-1 team, regardless of the position
-- points above.
--
-- Expected top5_score: 3 (pos1: predicted actual-2nd team, real top5 but
-- wrong slot) + 3 (pos2: predicted actual-1st team, real top5 but wrong
-- slot) + 6 (pos3: predicted actual-3rd team, exact) + 0 (pos4: predicted
-- actual-8th team, outside top5) + 0 (pos5: predicted actual-9th team,
-- outside top5) = 12. Expected winning_team_bonus: 0 (the pos1 prediction
-- was NOT the actual winner - that's deliberate, so this test also proves
-- the bonus is independent of ordinary top-5 points, not just implied by
-- them). Expected jersey_score: 4 exact holder picks x 5 = 20. Expected
-- total_score: 12 + 0 + 20 = 32.
select pg_temp.assert_true(
  (select score.top5_score
   from public.grandtour_stage_scores score
   where score.stage_id = 'd4000000-0000-4000-8000-000000000009'
     and score.user_id = 'd6000000-0000-4000-8000-000000000003') = 12,
  'TTT top5_score must be exactly 12 (3 + 3 + 6 + 0 + 0)'
);
select pg_temp.assert_true(
  (select score.bonus_score
   from public.grandtour_stage_scores score
   where score.stage_id = 'd4000000-0000-4000-8000-000000000009'
     and score.user_id = 'd6000000-0000-4000-8000-000000000003') = 0,
  'TTT bonus_score (winning team bonus) must be 0 - position 1 was not predicted to be the actual winning team'
);
select pg_temp.assert_true(
  (select score.jersey_score
   from public.grandtour_stage_scores score
   where score.stage_id = 'd4000000-0000-4000-8000-000000000009'
     and score.user_id = 'd6000000-0000-4000-8000-000000000003') = 20,
  'TTT jersey_score must be exactly 20 (4 exact holder picks x 5)'
);
select pg_temp.assert_true(
  (select score.total_score
   from public.grandtour_stage_scores score
   where score.stage_id = 'd4000000-0000-4000-8000-000000000009'
     and score.user_id = 'd6000000-0000-4000-8000-000000000003') = 32,
  'TTT total_score must be exactly 32 (12 top5 + 0 bonus + 20 jersey)'
);
select pg_temp.assert_true(
  (select score.score_details ->> 'stage_type'
   from public.grandtour_stage_scores score
   where score.stage_id = 'd4000000-0000-4000-8000-000000000009'
     and score.user_id = 'd6000000-0000-4000-8000-000000000003') = 'ttt',
  'score_details.stage_type must record ttt'
);
select pg_temp.assert_true(
  (select score.score_details -> 'top_five' -> 0 ->> 'target_type'
   from public.grandtour_stage_scores score
   where score.stage_id = 'd4000000-0000-4000-8000-000000000009'
     and score.user_id = 'd6000000-0000-4000-8000-000000000003') = 'team',
  'score_details.top_five entries must be target_type=team for a TTT stage'
);

\echo '=== 24. the tip status moved to scored, and the tip row carries the same total ==='
select pg_temp.assert_true(
  (select tip.status = 'scored' and tip.total_score = 32
   from public.grandtour_tips tip
   where tip.id = :'ttt_tip_id'::uuid),
  'the TTT tip must move to status=scored with total_score=32'
);

select 'GrandTour admin review workflow (mark_checked/finalize) RPC tests passed' as result;
rollback;
