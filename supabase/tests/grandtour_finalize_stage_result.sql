-- DB tests for the admin review workflow:
--   public.mark_grandtour_stage_result_checked(...)
--   public.finalize_grandtour_stage_result(...)  [4-arg, review_status-gated]
-- See supabase/migrations/20260710020000_grandtour_stage_result_review_workflow_schema.sql,
-- supabase/migrations/20260710030000_grandtour_admin_review_workflow_rpc.sql, and
-- supabase/migrations/20260710060000_grandtour_admin_check_finalise_authenticated_grants.sql
-- (adds the internal grandtour_private.is_cycling_admin() guard and the
-- `authenticated` EXECUTE grant that let these be called directly from the
-- Vercel-safe admin UI, not only via service_role).
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
-- Stage-2-shaped), one road stage with no result at all, and one TTT
-- stage. One admin user is provisioned so the post-finalize scoring test
-- (13) can call recalculate_grandtour_stage_scores(), which is security
-- invoker and requires grandtour_private.is_cycling_admin() = true.
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

insert into public.grandtour_stages (id, grand_tour_id, stage_number, stage_name, stage_type, ttt_timing_rule, starts_at, locks_at)
values
  ('d4000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 2, 'Finalize Test Stage 2', 'road', null, now() + interval '2 days', now() + interval '1 day'),
  ('d4000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 3, 'Finalize Test Stage 3 (no result yet)', 'road', null, now() + interval '3 days', now() + interval '2 days'),
  ('d4000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000001', 5, 'Finalize Test Stage 5 (authenticated-admin direct-call path)', 'road', null, now() + interval '5 days', now() + interval '4 days'),
  ('d4000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000001', 9, 'Finalize Test TTT Stage', 'ttt', 'individual_time', now() + interval '3 days', now() + interval '2 days');

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
where rider.grand_tour_id = 'd1000000-0000-4000-8000-000000000001';

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
where rider.grand_tour_id = 'd1000000-0000-4000-8000-000000000001';

insert into public.grandtour_stage_jersey_holders (stage_id, jersey_type, rider_id)
values
  ('d4000000-0000-4000-8000-000000000005', 'yellow', 'd3000000-0000-4000-8000-000000000001'),
  ('d4000000-0000-4000-8000-000000000005', 'green', 'd3000000-0000-4000-8000-000000000002'),
  ('d4000000-0000-4000-8000-000000000005', 'kom', 'd3000000-0000-4000-8000-000000000003'),
  ('d4000000-0000-4000-8000-000000000005', 'white', 'd3000000-0000-4000-8000-000000000004');

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

\echo '=== 8. cannot finalize a TTT stage ==='
do $$
begin
  begin
    set local role service_role;
    perform public.finalize_grandtour_stage_result('d4000000-0000-4000-8000-000000000009', 'd6000000-0000-4000-8000-000000000001');
    raise exception 'TTT stage finalize unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%TTT stage%' then raise; end if;
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

select 'GrandTour admin review workflow (mark_checked/finalize) RPC tests passed' as result;
rollback;
