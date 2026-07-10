-- GrandTour apply-mode Phase 0 write-permission verification.
--
-- Manual, local-only diagnostic script. NOT auto-applied by `supabase db
-- reset` (only supabase/seed.sql is, per supabase/config.toml). Run by hand
-- against a local Supabase instance only, e.g.:
--
--   docker exec -i supabase_db_tipping-suite psql -U postgres -d postgres \
--     -f supabase/seeds/grandtour_apply_mode_phase0_verification.sql
--
-- Purpose: empirically verify docs/grandtour-apply-mode-spec.md's Phase 0
-- questions (which roles can read/write which result/import tables, whether
-- a draft result insert succeeds, whether finalization without jersey
-- holders is rejected, whether a result line for a rider off the stage
-- startlist is rejected) against the REAL schema/RLS/grants, not assumption.
--
-- Safety: everything in this script runs inside a single transaction that
-- ends in ROLLBACK. Nothing it does — including the one GRANT statement in
-- step 8, which is transactional DDL in Postgres — persists after the
-- script finishes. It is read/write against local Postgres only; it never
-- runs against production, and it is not part of the application/
-- reconciliation code path (scripts/grandtour-reconciliation*.mjs remain
-- read-only, with no insert/upsert/update/delete/rpc calls anywhere).
--
-- Depends on supabase/seed.sql's seeded rows for grand tour
-- '10000000-0000-4000-8000-000000000001' (stage 2 = road/hilly, id
-- '50000000-0000-4000-8000-000000000002') and, ideally, on
-- supabase/seeds/grandtour_reconciliation_smoke.sql having been applied
-- (which removes rider 40000000-...-003 from stage 2's startlist — step 4
-- below relies on that to prove the startlist rejection; if that seed
-- hasn't been applied, step 4 will unexpectedly succeed instead of raising,
-- which is itself a useful signal that the smoke seed wasn't applied).

\set ON_ERROR_STOP off
\timing off

begin;

\echo '=== 0. Role RLS-bypass flags ==='
select rolname, rolbypassrls
from pg_roles
where rolname in ('anon', 'authenticated', 'service_role')
order by rolname;

\echo '=== 0b. Current table-level grants on the six target tables ==='
select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'grandtour_stage_results',
    'grandtour_stage_result_lines',
    'grandtour_stage_team_result_lines',
    'grandtour_stage_jersey_holders',
    'grandtour_feed_import_runs',
    'grandtour_feed_snapshots'
  )
  and grantee in ('anon', 'authenticated', 'service_role')
group by grantee, table_name
order by table_name, grantee;

\echo '=== 1. anon cannot insert a draft stage result (expect: permission denied) ==='
savepoint sp_anon_insert;
set local role anon;
insert into public.grandtour_stage_results (stage_id, is_final)
values ('50000000-0000-4000-8000-000000000002', false);
rollback to savepoint sp_anon_insert;
reset role;

\echo '=== 2. service_role CAN insert a draft (is_final=false) stage result ==='
set local role service_role;
insert into public.grandtour_stage_results (id, stage_id, is_final)
values ('99999999-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', false);

\echo '=== 3. service_role can insert result lines for riders who ARE on stage 2''s startlist ==='
insert into public.grandtour_stage_result_lines (stage_result_id, rider_id, actual_position)
values
  ('99999999-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000004', 1),
  ('99999999-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005', 2),
  ('99999999-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000006', 3),
  ('99999999-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007', 4),
  ('99999999-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000008', 5);

\echo '=== 4. a result line for a rider NOT on stage 2''s startlist is rejected (expect: "must be on the stage start list") ==='
savepoint sp_not_on_startlist;
insert into public.grandtour_stage_result_lines (stage_result_id, rider_id, actual_position)
values ('99999999-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 6);
rollback to savepoint sp_not_on_startlist;

\echo '=== 5. finalizing (is_final=true) is rejected without exactly 4 jersey holders (expect: finalization error) ==='
savepoint sp_finalize_no_jerseys;
update public.grandtour_stage_results set is_final = true
where id = '99999999-0000-4000-8000-000000000001';
rollback to savepoint sp_finalize_no_jerseys;

\echo '=== 6. sanity: the 5 legitimate result lines are unaffected by the two rejected attempts above ==='
select count(*) as result_line_count
from public.grandtour_stage_result_lines
where stage_result_id = '99999999-0000-4000-8000-000000000001';

\echo '=== 7. service_role currently CANNOT write grandtour_feed_import_runs (expect: permission denied — confirms the grant gap) ==='
savepoint sp_import_runs_no_grant;
insert into public.grandtour_feed_import_runs (grand_tour_id, provider_name, mode, import_status)
values ('10000000-0000-4000-8000-000000000001', 'official-letour', 'apply', 'pending');
rollback to savepoint sp_import_runs_no_grant;

\echo '=== 8. adding the missing grant (this transaction only) fixes it — proves the exact remediation needed ==='
reset role;
grant select, insert, update, delete
on table public.grandtour_feed_import_runs, public.grandtour_feed_snapshots
to service_role;
set local role service_role;
insert into public.grandtour_feed_import_runs (id, grand_tour_id, provider_name, mode, import_status)
values ('99999999-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'official-letour', 'apply', 'pending')
returning id, provider_name, mode, import_status;

reset role;
rollback;

\echo '=== Done. Transaction rolled back: no rows, grants, or other state persisted. ==='
