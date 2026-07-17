-- Satellite tables for the master UCI rider registry (public.uci_riders,
-- 20260717020000): aliases (for race-entry name matching), team history,
-- and season-aware specialties. See CLAUDE.md's "Master UCI Rider
-- Registry & Weekly Sync" section for the full design writeup.

-- Alias types this registry can generate/record. `manual` covers an alias
-- an admin explicitly approves via resolve_uci_rider_review_item()
-- (20260717040000) -- e.g. a race-organiser spelling that doesn't fit any
-- deterministic generation rule.
create type public.uci_rider_alias_type as enum (
  'uci_canonical',
  'surname_first',
  'given_name_first',
  'accentless',
  'race_organiser',
  'abbreviated',
  'former_name',
  'manual'
);

create table public.uci_rider_aliases (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.uci_riders(id) on delete cascade,
  alias_text text not null,
  normalized_alias text not null,
  alias_type public.uci_rider_alias_type not null,
  source text,
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  -- Deliberately NOT globally unique on normalized_alias alone -- shared
  -- names must stay legal (two different riders can genuinely have the
  -- same alias text). Unique per (rider_id, normalized_alias, alias_type)
  -- so the same rider can't accumulate duplicate alias rows of the same
  -- kind from a re-run of scripts/uci-rider-aliases.mjs's generation.
  unique (rider_id, normalized_alias, alias_type)
);

comment on table public.uci_rider_aliases is
  'Alternate names a uci_riders row may be matched against during race-entry matching (scripts/race-entry-rider-matching.mjs) -- deterministically generated (scripts/uci-rider-aliases.mjs) plus admin-approved manual aliases (resolve_uci_rider_review_item). Not globally unique on normalized_alias: shared names across different riders are expected and legal.';

-- Non-unique: cross-rider lookup during matching ("does any rider have
-- this alias?") is the primary read pattern.
create index uci_rider_aliases_normalized_alias_idx on public.uci_rider_aliases (normalized_alias);
create index uci_rider_aliases_rider_id_idx on public.uci_rider_aliases (rider_id);

alter table public.uci_rider_aliases enable row level security;

create policy "Anyone can view UCI rider aliases"
on public.uci_rider_aliases for select
to anon, authenticated
using (true);

revoke all on table public.uci_rider_aliases from public, anon, authenticated;
grant select on table public.uci_rider_aliases to anon, authenticated;
grant select, insert, update, delete on table public.uci_rider_aliases to service_role;

create table public.uci_rider_team_history (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.uci_riders(id) on delete cascade,
  -- Resolved opportunistically by scripts/uci-rider-team-history.mjs, only
  -- on an exact normalized name/code match against public.grandtour_teams
  -- for whichever race context that script is run alongside -- never
  -- auto-merged on name similarity alone. Left null when no confident
  -- match exists; "set null" so deleting a tour-scoped team never cascades
  -- into deleting cross-race history.
  team_id uuid references public.grandtour_teams(id) on delete set null,
  source_team_name text not null,
  source_team_code text,
  season_year integer,
  valid_from date,
  valid_to date,
  discipline text not null default 'road',
  source text not null default 'uci',
  last_verified_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.uci_rider_team_history is
  'Per-season team history sourced from UCI''s rider-details payload (scripts/uci-parsers.mjs''s teamHistoryRaw). team_id is resolved opportunistically, only on exact normalized name/code equality against public.grandtour_teams -- see scripts/uci-rider-team-history.mjs -- and stays null otherwise; never auto-merged on fuzzy similarity.';

-- Idempotent re-sync upserts key on this expression, not a plain table
-- constraint: a bare `unique (...)` constraint can't reference a function
-- call like coalesce() directly (Postgres syntax requires a plain column
-- list there), so this is expressed as a unique index instead.
-- coalesce(source_team_code, '') because a bare unique index would
-- otherwise treat two NULLs as distinct, letting a re-sync insert
-- duplicate rows for a season with no team code.
create unique index uci_rider_team_history_upsert_key_uidx
  on public.uci_rider_team_history (rider_id, season_year, coalesce(source_team_code, ''), source);

create index uci_rider_team_history_rider_id_idx on public.uci_rider_team_history (rider_id);
create index uci_rider_team_history_team_id_idx on public.uci_rider_team_history (team_id);

alter table public.uci_rider_team_history enable row level security;

create policy "Anyone can view UCI rider team history"
on public.uci_rider_team_history for select
to anon, authenticated
using (true);

revoke all on table public.uci_rider_team_history from public, anon, authenticated;
grant select on table public.uci_rider_team_history to anon, authenticated;
grant select, insert, update, delete on table public.uci_rider_team_history to service_role;

-- Specialty is kept deliberately separate from core identity (uci_riders
-- itself carries no specialty column) because it is season-aware and
-- UCI's own data surface supplies none of it at all -- see
-- scripts/uci-rider-specialty.mjs, which only ever preserves whatever
-- already exists in Supabase (imported from
-- scripts/tdf-2026-rider-specialty.mjs's SUPPORTED_SPECIALTIES/
-- resolveSpecialty, not redefined here).
create table public.uci_rider_specialties (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.uci_riders(id) on delete cascade,
  season integer not null,
  -- Checked against the existing ten-value SUPPORTED_SPECIALTIES
  -- vocabulary from scripts/tdf-2026-rider-specialty.mjs (gc, climber,
  -- sprinter, puncheur, time_trial, classics, rouleur, all_rounder,
  -- domestique, unknown) -- reused, not redefined, so the two never drift
  -- independently.
  primary_specialty text check (primary_specialty in (
    'gc', 'climber', 'sprinter', 'puncheur', 'time_trial', 'classics',
    'rouleur', 'all_rounder', 'domestique', 'unknown'
  )),
  secondary_specialty text check (secondary_specialty in (
    'gc', 'climber', 'sprinter', 'puncheur', 'time_trial', 'classics',
    'rouleur', 'all_rounder', 'domestique', 'unknown'
  )),
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  evidence jsonb not null default '{}'::jsonb,
  source text not null default 'unknown' check (source in ('existing_supabase', 'manual', 'unknown')),
  manually_reviewed boolean not null default false,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rider_id, season)
);

comment on table public.uci_rider_specialties is
  'Season-aware specialty classification for a uci_riders row. UCI supplies no specialty signal at all -- scripts/uci-rider-specialty.mjs never infers a fresh classification from UCI data, only preserves a trusted existing value (source=existing_supabase) or reports unknown.';

create index uci_rider_specialties_rider_id_idx on public.uci_rider_specialties (rider_id);

alter table public.uci_rider_specialties enable row level security;

create policy "Anyone can view UCI rider specialties"
on public.uci_rider_specialties for select
to anon, authenticated
using (true);

revoke all on table public.uci_rider_specialties from public, anon, authenticated;
grant select on table public.uci_rider_specialties to anon, authenticated;
grant select, insert, update, delete on table public.uci_rider_specialties to service_role;

create trigger uci_rider_specialties_set_updated_at
before update on public.uci_rider_specialties
for each row execute function app_private.set_updated_at();
