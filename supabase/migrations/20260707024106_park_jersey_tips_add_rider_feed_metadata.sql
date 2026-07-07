-- Park user-entered stage jersey tips without deleting official jersey data.
-- Stage entries are complete when they contain the correct five stage-result
-- selections. Overall jersey tips remain backend-supported but are no longer
-- exposed in the user UI.

alter table public.grandtour_riders
  add column if not exists specialities text[],
  add column if not exists status text not null default 'active',
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_reason text;

alter table public.grandtour_riders
  drop constraint if exists grandtour_riders_status_check,
  add constraint grandtour_riders_status_check
  check (status in ('active', 'dns', 'dnf', 'otl', 'withdrawn', 'suspended', 'excluded', 'unknown'));

alter table public.grandtour_riders
  drop constraint if exists grandtour_riders_specialities_check,
  add constraint grandtour_riders_specialities_check
  check (
    specialities is null
    or specialities <@ array[
      'gc',
      'sprint',
      'mountain',
      'time_trial',
      'classics',
      'all_rounder',
      'domestique',
      'leadout',
      'breakaway'
    ]::text[]
  );

create index if not exists grandtour_riders_status_idx
on public.grandtour_riders (grand_tour_id, status);

create index if not exists grandtour_riders_specialities_gin_idx
on public.grandtour_riders using gin (specialities);

alter table public.grandtour_stage_startlists
  add column if not exists specialities text[],
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_reason text;

alter table public.grandtour_stage_startlists
  drop constraint if exists grandtour_stage_startlists_status_check,
  add constraint grandtour_stage_startlists_status_check
  check (status in ('provisional', 'confirmed', 'withdrawn', 'reserve', 'dns', 'dnf', 'otl', 'suspended', 'excluded', 'unknown'));

alter table public.grandtour_stage_startlists
  drop constraint if exists grandtour_stage_startlists_specialities_check,
  add constraint grandtour_stage_startlists_specialities_check
  check (
    specialities is null
    or specialities <@ array[
      'gc',
      'sprint',
      'mountain',
      'time_trial',
      'classics',
      'all_rounder',
      'domestique',
      'leadout',
      'breakaway'
    ]::text[]
  );

create index if not exists grandtour_stage_startlists_specialities_gin_idx
on public.grandtour_stage_startlists using gin (specialities);

create table if not exists public.grandtour_feed_import_runs (
  id uuid primary key default gen_random_uuid(),
  grand_tour_id uuid references public.grand_tours(id) on delete cascade,
  provider_name text not null,
  source_url text,
  mode text not null default 'dry_run',
  import_status text not null default 'pending',
  fetched_at timestamptz not null default now(),
  applied_at timestamptz,
  validation_errors jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (mode in ('dry_run', 'review', 'apply')),
  check (import_status in ('pending', 'validated', 'applied', 'failed', 'skipped'))
);

create table if not exists public.grandtour_feed_snapshots (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.grandtour_feed_import_runs(id) on delete cascade,
  segment text not null,
  source_name text not null,
  source_url text,
  fetched_at timestamptz not null default now(),
  confidence text not null default 'unknown',
  raw_payload jsonb not null,
  normalized_payload jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  check (segment in ('stage_metadata', 'stage_result', 'ttt_result', 'jersey_holders', 'rider_status', 'startlist', 'team_data'))
);

alter table public.grandtour_feed_import_runs enable row level security;
alter table public.grandtour_feed_snapshots enable row level security;

drop policy if exists "Cycling admins manage GrandTour feed import runs"
on public.grandtour_feed_import_runs;
create policy "Cycling admins manage GrandTour feed import runs"
on public.grandtour_feed_import_runs
for all to authenticated
using (grandtour_private.is_cycling_admin())
with check (grandtour_private.is_cycling_admin());

drop policy if exists "Cycling admins manage GrandTour feed snapshots"
on public.grandtour_feed_snapshots;
create policy "Cycling admins manage GrandTour feed snapshots"
on public.grandtour_feed_snapshots
for all to authenticated
using (grandtour_private.is_cycling_admin())
with check (grandtour_private.is_cycling_admin());

create or replace function grandtour_private.tip_is_complete(target_tip_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_scope public.grandtour_tip_scope;
  target_stage_type text;
  required_jerseys public.grandtour_jersey_type[];
  top_five_count integer;
  jersey_count integer;
begin
  select
    tip.tip_scope,
    stage.stage_type::text,
    competition.active_jersey_types
  into target_scope, target_stage_type, required_jerseys
  from public.grandtour_tips tip
  join public.grandtour_competitions competition
    on competition.id = tip.competition_id
  left join public.grandtour_stages stage on stage.id = tip.stage_id
  where tip.id = target_tip_id;

  if target_scope is null then
    return false;
  end if;

  if target_scope = 'stage' then
    select count(*) into top_five_count
    from public.grandtour_tip_selections selection
    where selection.tip_id = target_tip_id
      and selection.selection_type = 'stage_top_5'
      and selection.predicted_position between 1 and 5
      and (
        (
          target_stage_type in ('team_time_trial', 'ttt')
          and selection.team_id is not null
          and selection.rider_id is null
        )
        or
        (
          target_stage_type not in ('team_time_trial', 'ttt')
          and selection.rider_id is not null
          and selection.team_id is null
        )
      );

    return top_five_count = 5;
  end if;

  select count(*) into jersey_count
  from public.grandtour_tip_selections selection
  where selection.tip_id = target_tip_id
    and selection.rider_id is not null
    and selection.team_id is null
    and selection.selection_type = any (
      array[
        'overall_yellow_winner',
        'overall_green_winner',
        'overall_kom_winner',
        'overall_white_winner'
      ]::public.grandtour_tip_selection_type[]
    )
    and case selection.selection_type
      when 'overall_yellow_winner' then 'yellow'::public.grandtour_jersey_type
      when 'overall_green_winner' then 'green'::public.grandtour_jersey_type
      when 'overall_kom_winner' then 'kom'::public.grandtour_jersey_type
      when 'overall_white_winner' then 'white'::public.grandtour_jersey_type
    end = any (required_jerseys);

  return jersey_count = coalesce(cardinality(required_jerseys), 0);
end;
$$;
