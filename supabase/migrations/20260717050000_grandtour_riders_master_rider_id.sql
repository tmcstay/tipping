-- Links a tour-scoped public.grandtour_riders entry up to its canonical
-- cross-race identity in the new public.uci_riders registry
-- (20260717020000). A single nullable column, on delete set null -- the
-- master registry disappearing (or a rider row there being merged/removed)
-- must never cascade into deleting a tour's own rider entry, which every
-- other tour-scoped table (grandtour_tip_selections,
-- grandtour_stage_result_lines, grandtour_stage_jersey_holders,
-- grandtour_favourite_riders) still depends on existing.
--
-- Nothing else about public.grandtour_riders changes: no existing FK, RLS
-- policy, or downstream consumer is touched. Population of this column is
-- a separate, additive step (scripts/tdf-2026-registry-match-report.mjs
-- for the Tour 2026 migration path; scripts/race-entry-rider-matching.mjs
-- for any future race) -- this migration only adds the column and index.
alter table public.grandtour_riders
  add column if not exists master_rider_id uuid references public.uci_riders(id) on delete set null;

create index if not exists grandtour_riders_master_rider_id_idx
  on public.grandtour_riders (master_rider_id);
