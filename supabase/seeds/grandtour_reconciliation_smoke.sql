-- Test-only seed for validating the official-letour reconciliation dry-run
-- (scripts/grandtour-reconciliation.mjs, scripts/grandtour-reconciliation-supabase.mjs)
-- against a real local Supabase instance.
--
-- NOT auto-applied by `npx supabase db reset` — only `supabase/seed.sql` is,
-- per `supabase/config.toml`'s `db.seed.sql_paths`. Apply manually, after a
-- reset, against the LOCAL database only:
--
--   npx supabase db reset
--   psql "$(npx supabase status -o env | grep DB_URL | cut -d'"' -f2)" \
--     -f supabase/seeds/grandtour_reconciliation_smoke.sql
--
-- See docs/grandtour-results-feed.md's "Local reconciliation smoke test"
-- section for the full walkthrough. This file only UPDATEs bib_number on the
-- riders already inserted by supabase/seed.sql, and DELETEs one specific
-- grandtour_stage_startlists row (see below), for the seeded
-- 'GrandTour France 2026' grand tour (id 10000000-0000-4000-8000-000000000001)
-- — it never touches any other grand tour and never runs against a
-- production/remote database. These are test-fixture-setup statements for a
-- local seed only, not part of the reconciliation application code, which
-- remains read-only (scripts/grandtour-reconciliation.mjs,
-- scripts/grandtour-reconciliation-supabase.mjs contain no
-- insert/upsert/update/delete calls).

-- Assign deterministic, distinct bib numbers derived from each seeded
-- rider's UUID suffix, offset by 900, so bib-number matching has real data
-- to work with in the reconciliation smoke test. The 900+ offset is
-- deliberate: scripts/load-tdf-2026-startlist.mjs may also be applied
-- against this same local 'GrandTour France 2026' grand tour, and its
-- official riders use bibs 1-228 (23 teams x up to 8 riders each, in
-- per-team decade blocks like 1-8, 11-18, ... 221-228). Bib matching in
-- scripts/grandtour-reconciliation.mjs's classifyRiderMatch() is global
-- across every rider in the grand tour (not scoped by team), so this
-- fixture's bibs must never fall in the 1-228 range or they would
-- spuriously collide with real official riders and make unrelated
-- reconciliation scenarios ambiguous.
update public.grandtour_riders
set bib_number = 900 + right(id::text, 3)::int
where grand_tour_id = '10000000-0000-4000-8000-000000000001'
  and id::text like '40000000-0000-4000-8000-%';

-- Deliberately collide two riders on the same bib number so the
-- reconciliation smoke test can exercise a genuine "ambiguous rider match"
-- against real DB state (the schema forbids duplicate normalized_name per
-- grand tour, so a name-based collision cannot occur here — only a
-- bib-number collision can, and the reconciliation layer must handle it).
update public.grandtour_riders
set bib_number = 901
where id in (
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002'
);

-- supabase/seed.sql puts every seeded rider on every seeded stage's
-- startlist (its "MVP simplification"), so there is otherwise no real DB
-- state where a matched rider is missing from a stage startlist. Remove
-- rider 000000000003 (Mathieu Delorme, bib 3) from stage 2's startlist only,
-- so the reconciliation smoke test can exercise a genuine
-- "matched rider missing from startlist" case against real data.
delete from public.grandtour_stage_startlists
where stage_id = '50000000-0000-4000-8000-000000000002'
  and rider_id = '40000000-0000-4000-8000-000000000003';
