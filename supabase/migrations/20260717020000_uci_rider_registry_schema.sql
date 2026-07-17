-- Master UCI rider registry: `public.uci_riders`.
--
-- Context (see CLAUDE.md's "Master UCI Rider Registry & Weekly Sync"
-- section for the full writeup): the TDF 2026 rider importer
-- (scripts/tdf-2026-rider-importer.mjs) proved out UCI's public rider
-- search/profile data surface as a reliable identity source, but writes
-- directly into public.grandtour_riders, which is tour-scoped
-- (grand_tour_id not null, cascade-deleted with its tour, unique per
-- (grand_tour_id, normalized_name)). A rider who races the Tour, the Giro,
-- and the Vuelta today has no single identity record under that schema,
-- and any future race's start list would need its own from-scratch
-- importer with no shared rider identity to match against.
--
-- public.grandtour_riders/grandtour_teams/grandtour_stage_startlists are
-- all tour-scoped and cannot become the cross-race master table without
-- breaking their own FK graph (grandtour_tip_selections,
-- grandtour_stage_result_lines, grandtour_stage_jersey_holders,
-- grandtour_favourite_riders all point at grandtour_riders.id today with
-- RESTRICT/CASCADE semantics tuned for a single tour's lifecycle) --
-- confirmed by reading every migration that references grandtour_riders
-- before writing this one. Repurposing that table as the master registry
-- was explicitly rejected; this migration instead adds a new, separate
-- table family as the canonical cross-race registry, linked to
-- grandtour_riders by a single nullable FK column added in
-- 20260717050000_grandtour_riders_master_rider_id.sql. Every existing FK,
-- RLS policy, and downstream consumer of grandtour_riders is untouched by
-- this migration.
--
-- grandtour_riders has no external-id column at all (source_url is used
-- as an ad hoc stable key by convention only, per
-- scripts/tdf-2026-rider-match.mjs's matchRider) -- this is exactly the
-- gap a uci_rider_id-keyed master table fills.
--
-- "Who can write" follows the same shape as grandtour_riders/
-- grandtour_teams: RLS enabled, a public select policy for anon/
-- authenticated, and all writes are service_role-only grants -- the sync
-- CLI (scripts/uci-rider-sync.mjs), not the app, is the only writer.
--
-- Team linkage is deliberately NOT a foreign key here: grandtour_teams is
-- itself tour-scoped, so a rider's UCI-sourced current team and team
-- history are stored as source text (current_team_name/current_team_code)
-- at sync time. Resolving a specific grandtour_teams.id only happens
-- later, contextually, during race-entry matching for one particular race
-- (see scripts/uci-rider-team-history.mjs) -- never as a permanent field
-- on the canonical rider.
create table public.uci_riders (
  id uuid primary key default gen_random_uuid(),
  uci_rider_id text,
  uci_code text,
  given_name text,
  family_name text,
  display_name text not null,
  -- Plain trim/lowercase/collapse-whitespace, matching
  -- scripts/tdf-2026-rider-match.mjs's dbNormalizedName convention --
  -- deliberately NOT accent-folded (see that function's own doc comment:
  -- accent-stripping here would silently fail to match an existing
  -- accented display_name). Never unique on its own -- names are never
  -- the sole identity key for this registry; see
  -- scripts/uci-rider-registry.mjs and scripts/race-entry-rider-matching.mjs.
  normalized_name text not null,
  date_of_birth date,
  nationality text,
  gender text,
  discipline text not null default 'road',
  current_team_name text,
  current_team_code text,
  uci_profile_url text,
  is_active boolean not null default true,
  source_updated_at timestamptz,
  last_verified_at timestamptz,
  last_seen_at timestamptz,
  consecutive_absences integer not null default 0,
  data_confidence text not null default 'medium' check (data_confidence in ('low', 'medium', 'high')),
  manual_review_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (consecutive_absences >= 0)
);

comment on table public.uci_riders is
  'Canonical cross-race rider identity registry, sourced primarily from UCI''s public rider search/profile data surface (see scripts/uci-client.mjs). Not tour-scoped -- unlike public.grandtour_riders, one row here represents one real-world rider across every race. public.grandtour_riders.master_rider_id (added in 20260717050000) links a tour-scoped rider entry up to its canonical identity here; the reverse is intentionally not modelled as a 1:1 (a rider may exist here with no grandtour_riders row yet, e.g. before any race entry has been matched).';

-- uci_rider_id is the strongest identity signal (an opaque, UCI-assigned,
-- stable id -- see scripts/uci-parsers.mjs's uciRiderIdFromUrl) but is not
-- always known (a rider discovered only via a race entry with no
-- confident UCI match yet may have a row with uci_rider_id null and
-- manual_review_required = true). A partial unique index -- rather than a
-- plain column-level unique constraint -- is required so that multiple
-- null-uci_rider_id rows can coexist.
create unique index uci_riders_uci_rider_id_uidx
  on public.uci_riders (uci_rider_id)
  where uci_rider_id is not null;

-- Non-unique: many riders can legitimately share a normalized_name (common
-- surnames); this index exists purely to make normalized_name-based
-- candidate lookup (the fallback tier in
-- scripts/uci-rider-registry.mjs/scripts/race-entry-rider-matching.mjs)
-- efficient, never as a uniqueness guarantee.
create index uci_riders_normalized_name_idx on public.uci_riders (normalized_name);
create index uci_riders_discipline_idx on public.uci_riders (discipline);

alter table public.uci_riders enable row level security;

-- Public read, matching grandtour_riders' own "Anyone can view GrandTour
-- riders" policy shape -- this registry is not sensitive data, and race
-- screens/admin tooling both need to read it without an admin session.
create policy "Anyone can view UCI riders"
on public.uci_riders for select
to anon, authenticated
using (true);

-- All writes come from scripts/uci-rider-sync.mjs's --apply path
-- (service_role key only), matching grandtour_riders/grandtour_teams'
-- existing "no authenticated write path" convention -- there is no
-- admin-UI write surface for this table today.
revoke all on table public.uci_riders from public, anon, authenticated;
grant select on table public.uci_riders to anon, authenticated;
grant select, insert, update, delete on table public.uci_riders to service_role;

-- app_private.set_updated_at() already exists (created in
-- 20260715030000_grandtour_notification_preferences.sql) and is reused
-- here rather than redefined, per house convention.
create trigger uci_riders_set_updated_at
before update on public.uci_riders
for each row execute function app_private.set_updated_at();
