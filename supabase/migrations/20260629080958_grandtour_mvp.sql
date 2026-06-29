-- GrandTour MVP is additive. The original generic/F1-era tables remain untouched
-- until their production data and migration history can be assessed separately.

create type public.grandtour_tip_mode as enum (
  'preselection',
  'daily'
);

create type public.grandtour_tip_status as enum (
  'draft',
  'submitted',
  'locked',
  'scored'
);

create type public.grandtour_tip_selection_type as enum (
  'stage_top_5',
  'yellow_holder',
  'green_holder',
  'kom_holder',
  'white_holder'
);

create type public.grandtour_jersey_type as enum (
  'yellow',
  'green',
  'kom',
  'white'
);

create type public.grandtour_stage_type as enum (
  'flat',
  'hilly',
  'mountain',
  'individual_time_trial',
  'team_time_trial',
  'rest_day'
);

create table public.grand_tours (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  year int not null,
  starts_at timestamptz,
  ends_at timestamptz,
  preselection_locks_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (name, year),
  check (ends_at is null or starts_at is null or ends_at >= starts_at),
  check (starts_at is null or preselection_locks_at <= starts_at)
);

create table public.grandtour_competitions (
  id uuid primary key default gen_random_uuid(),
  grand_tour_id uuid not null references public.grand_tours(id) on delete cascade,
  name text not null,
  is_public boolean not null default true,
  allow_preselection boolean not null default true,
  allow_daily boolean not null default true,
  created_at timestamptz not null default now(),
  unique (grand_tour_id, name)
);

create table public.grandtour_teams (
  id uuid primary key default gen_random_uuid(),
  grand_tour_id uuid not null references public.grand_tours(id) on delete cascade,
  name text not null,
  short_name text,
  created_at timestamptz not null default now(),
  unique (grand_tour_id, name)
);

create table public.grandtour_riders (
  id uuid primary key default gen_random_uuid(),
  grand_tour_id uuid not null references public.grand_tours(id) on delete cascade,
  team_id uuid references public.grandtour_teams(id) on delete set null,
  display_name text not null,
  country text,
  rider_type text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (grand_tour_id, display_name)
);

create table public.grandtour_stages (
  id uuid primary key default gen_random_uuid(),
  grand_tour_id uuid not null references public.grand_tours(id) on delete cascade,
  stage_number int not null,
  stage_name text,
  stage_type public.grandtour_stage_type not null,
  starts_at timestamptz not null,
  locks_at timestamptz not null,
  start_location text,
  finish_location text,
  distance_km numeric,
  created_at timestamptz not null default now(),
  unique (grand_tour_id, stage_number),
  check (stage_number > 0),
  check (locks_at <= starts_at),
  check (distance_km is null or distance_km >= 0)
);

create table public.grandtour_stage_startlists (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.grandtour_stages(id) on delete cascade,
  rider_id uuid not null references public.grandtour_riders(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (stage_id, rider_id)
);

create table public.grandtour_tips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  competition_id uuid not null references public.grandtour_competitions(id) on delete cascade,
  stage_id uuid not null references public.grandtour_stages(id) on delete cascade,
  tip_mode public.grandtour_tip_mode not null,
  status public.grandtour_tip_status not null default 'draft',
  submitted_at timestamptz,
  locked_at timestamptz,
  total_score int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, competition_id, stage_id, tip_mode),
  check (total_score between 0 and 130)
);

create table public.grandtour_tip_selections (
  id uuid primary key default gen_random_uuid(),
  tip_id uuid not null references public.grandtour_tips(id) on delete cascade,
  selection_type public.grandtour_tip_selection_type not null,
  rider_id uuid not null references public.grandtour_riders(id) on delete restrict,
  predicted_position int,
  created_at timestamptz not null default now(),
  check (
    (
      selection_type = 'stage_top_5'
      and predicted_position between 1 and 5
    )
    or
    (
      selection_type <> 'stage_top_5'
      and predicted_position is null
    )
  )
);

create unique index grandtour_tip_selections_top5_slot_uidx
on public.grandtour_tip_selections (tip_id, predicted_position)
where selection_type = 'stage_top_5';

create unique index grandtour_tip_selections_jersey_type_uidx
on public.grandtour_tip_selections (tip_id, selection_type)
where selection_type <> 'stage_top_5';

create unique index grandtour_tip_selections_top5_rider_uidx
on public.grandtour_tip_selections (tip_id, rider_id)
where selection_type = 'stage_top_5';

create table public.grandtour_stage_results (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.grandtour_stages(id) on delete cascade,
  is_final boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stage_id)
);

create table public.grandtour_stage_result_lines (
  id uuid primary key default gen_random_uuid(),
  stage_result_id uuid not null references public.grandtour_stage_results(id) on delete cascade,
  rider_id uuid not null references public.grandtour_riders(id) on delete restrict,
  actual_position int not null check (actual_position between 1 and 5),
  created_at timestamptz not null default now(),
  unique (stage_result_id, actual_position),
  unique (stage_result_id, rider_id)
);

create table public.grandtour_stage_jersey_holders (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.grandtour_stages(id) on delete cascade,
  jersey_type public.grandtour_jersey_type not null,
  rider_id uuid not null references public.grandtour_riders(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stage_id, jersey_type)
);

create table public.grandtour_stage_scores (
  id uuid primary key default gen_random_uuid(),
  tip_id uuid not null references public.grandtour_tips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  competition_id uuid not null references public.grandtour_competitions(id) on delete cascade,
  stage_id uuid not null references public.grandtour_stages(id) on delete cascade,
  tip_mode public.grandtour_tip_mode not null,
  top5_score int not null default 0,
  jersey_score int not null default 0,
  bonus_score int not null default 0,
  total_score int not null default 0,
  score_details jsonb not null default '{}'::jsonb,
  scored_at timestamptz not null default now(),
  unique (tip_id),
  check (top5_score between 0 and 50),
  check (jersey_score between 0 and 40),
  check (bonus_score between 0 and 40),
  check (total_score = top5_score + jersey_score + bonus_score),
  check (total_score between 0 and 130)
);

create table public.grandtour_leaderboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.grandtour_competitions(id) on delete cascade,
  leaderboard_type text not null check (
    leaderboard_type in ('daily', 'preselection', 'overall')
  ),
  user_id uuid not null references auth.users(id) on delete cascade,
  rank int not null check (rank > 0),
  total_score int not null default 0 check (total_score >= 0),
  stages_tipped int not null default 0 check (stages_tipped >= 0),
  last_stage_score int check (last_stage_score between 0 and 130),
  snapshot_at timestamptz not null default now()
);

-- Supporting indexes, including every requested ownership and lookup column.
create index grandtour_competitions_grand_tour_id_idx
on public.grandtour_competitions (grand_tour_id);
create index grandtour_teams_grand_tour_id_idx
on public.grandtour_teams (grand_tour_id);
create index grandtour_riders_grand_tour_id_idx
on public.grandtour_riders (grand_tour_id);
create index grandtour_riders_team_id_idx
on public.grandtour_riders (team_id);
create index grandtour_stages_grand_tour_id_idx
on public.grandtour_stages (grand_tour_id);
create index grandtour_stage_startlists_stage_id_idx
on public.grandtour_stage_startlists (stage_id);
create index grandtour_stage_startlists_rider_id_idx
on public.grandtour_stage_startlists (rider_id);
create index grandtour_tips_user_id_idx
on public.grandtour_tips (user_id);
create index grandtour_tips_competition_id_idx
on public.grandtour_tips (competition_id);
create index grandtour_tips_stage_id_idx
on public.grandtour_tips (stage_id);
create index grandtour_tips_tip_mode_idx
on public.grandtour_tips (tip_mode);
create index grandtour_tip_selections_tip_id_idx
on public.grandtour_tip_selections (tip_id);
create index grandtour_tip_selections_rider_id_idx
on public.grandtour_tip_selections (rider_id);
create index grandtour_stage_results_stage_id_idx
on public.grandtour_stage_results (stage_id);
create index grandtour_stage_result_lines_stage_result_id_idx
on public.grandtour_stage_result_lines (stage_result_id);
create index grandtour_stage_result_lines_rider_id_idx
on public.grandtour_stage_result_lines (rider_id);
create index grandtour_stage_jersey_holders_stage_id_idx
on public.grandtour_stage_jersey_holders (stage_id);
create index grandtour_stage_jersey_holders_rider_id_idx
on public.grandtour_stage_jersey_holders (rider_id);
create index grandtour_stage_scores_user_id_idx
on public.grandtour_stage_scores (user_id);
create index grandtour_stage_scores_competition_id_idx
on public.grandtour_stage_scores (competition_id);
create index grandtour_stage_scores_stage_id_idx
on public.grandtour_stage_scores (stage_id);
create index grandtour_stage_scores_tip_mode_idx
on public.grandtour_stage_scores (tip_mode);
create index grandtour_leaderboard_snapshots_user_id_idx
on public.grandtour_leaderboard_snapshots (user_id);
create index grandtour_leaderboard_snapshots_competition_id_idx
on public.grandtour_leaderboard_snapshots (competition_id);
create index grandtour_leaderboard_snapshots_type_idx
on public.grandtour_leaderboard_snapshots (leaderboard_type);
create index grandtour_leaderboard_snapshots_lookup_idx
on public.grandtour_leaderboard_snapshots (
  competition_id,
  leaderboard_type,
  snapshot_at desc,
  rank
);

-- Trigger functions live outside the exposed public schema and use invoker rights.
create schema if not exists grandtour_private;
revoke all on schema grandtour_private from public, anon, authenticated;

create function grandtour_private.validate_rider_team()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.team_id is not null and not exists (
    select 1
    from public.grandtour_teams team
    where team.id = new.team_id
      and team.grand_tour_id = new.grand_tour_id
  ) then
    raise exception 'Rider team must belong to the same grand tour.';
  end if;

  return new;
end;
$$;

create function grandtour_private.validate_startlist_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.grandtour_stages stage
    join public.grandtour_riders rider
      on rider.id = new.rider_id
     and rider.grand_tour_id = stage.grand_tour_id
    where stage.id = new.stage_id
  ) then
    raise exception 'Start-list rider and stage must belong to the same grand tour.';
  end if;

  return new;
end;
$$;

create function grandtour_private.prepare_tip()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  competition_allows_mode boolean;
begin
  select case
    when new.tip_mode = 'preselection' then competition.allow_preselection
    when new.tip_mode = 'daily' then competition.allow_daily
    else false
  end
  into competition_allows_mode
  from public.grandtour_competitions competition
  join public.grandtour_stages stage
    on stage.grand_tour_id = competition.grand_tour_id
  where competition.id = new.competition_id
    and stage.id = new.stage_id;

  if competition_allows_mode is null then
    raise exception 'Competition and stage must belong to the same grand tour.';
  end if;

  if not competition_allows_mode then
    raise exception 'This competition does not allow the selected tip mode.';
  end if;

  if new.status = 'submitted'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if (
      select count(*)
      from public.grandtour_tip_selections selection
      where selection.tip_id = new.id
        and selection.selection_type = 'stage_top_5'
    ) <> 5 then
      raise exception 'A submitted GrandTour tip requires five top-five selections.';
    end if;

    if (
      select count(*)
      from public.grandtour_tip_selections selection
      where selection.tip_id = new.id
        and selection.selection_type <> 'stage_top_5'
    ) <> 4 then
      raise exception 'A submitted GrandTour tip requires all four jersey selections.';
    end if;

    new.submitted_at := now();
  elsif new.status = 'draft' then
    new.submitted_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create function grandtour_private.validate_tip_selection()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_stage_id uuid;
begin
  select tip.stage_id
  into selected_stage_id
  from public.grandtour_tips tip
  join public.grandtour_stages stage on stage.id = tip.stage_id
  join public.grandtour_riders rider
    on rider.id = new.rider_id
   and rider.grand_tour_id = stage.grand_tour_id
  where tip.id = new.tip_id;

  if selected_stage_id is null then
    raise exception 'Selected rider must belong to the tip grand tour.';
  end if;

  if not exists (
    select 1
    from public.grandtour_stage_startlists startlist
    where startlist.stage_id = selected_stage_id
      and startlist.rider_id = new.rider_id
  ) then
    raise exception 'Selected rider must be on the stage start list.';
  end if;

  return new;
end;
$$;

create function grandtour_private.validate_result_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_stage_id uuid;
  result_is_final boolean;
begin
  select result.stage_id, result.is_final
  into selected_stage_id, result_is_final
  from public.grandtour_stage_results result
  join public.grandtour_stages stage on stage.id = result.stage_id
  join public.grandtour_riders rider
    on rider.id = new.rider_id
   and rider.grand_tour_id = stage.grand_tour_id
  where result.id = new.stage_result_id;

  if selected_stage_id is null then
    raise exception 'Result rider must belong to the result grand tour.';
  end if;

  if result_is_final then
    raise exception 'Final stage results must be reopened before editing result lines.';
  end if;

  if not exists (
    select 1
    from public.grandtour_stage_startlists startlist
    where startlist.stage_id = selected_stage_id
      and startlist.rider_id = new.rider_id
  ) then
    raise exception 'Result rider must be on the stage start list.';
  end if;

  return new;
end;
$$;

create function grandtour_private.validate_jersey_holder()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  result_is_final boolean;
begin
  if not exists (
    select 1
    from public.grandtour_stages stage
    join public.grandtour_riders rider
      on rider.id = new.rider_id
     and rider.grand_tour_id = stage.grand_tour_id
    join public.grandtour_stage_startlists startlist
      on startlist.stage_id = stage.id
     and startlist.rider_id = rider.id
    where stage.id = new.stage_id
  ) then
    raise exception 'Jersey holder must be on the stage start list.';
  end if;

  select result.is_final
  into result_is_final
  from public.grandtour_stage_results result
  where result.stage_id = new.stage_id;

  if result_is_final is null then
    raise exception 'Create a stage result before entering jersey holders.';
  end if;

  if result_is_final then
    raise exception 'Final stage results must be reopened before editing jersey holders.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create function grandtour_private.prevent_final_result_line_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.grandtour_stage_results result
    where result.id = old.stage_result_id
      and result.is_final
  ) then
    raise exception 'Final stage results must be reopened before deleting result lines.';
  end if;

  return old;
end;
$$;

create function grandtour_private.prevent_final_jersey_holder_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.grandtour_stage_results result
    where result.stage_id = old.stage_id
      and result.is_final
  ) then
    raise exception 'Final stage results must be reopened before deleting jersey holders.';
  end if;

  return old;
end;
$$;

create function grandtour_private.validate_final_result()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_final and (tg_op = 'INSERT' or old.is_final is distinct from new.is_final) then
    if (
      select count(*)
      from public.grandtour_stage_result_lines line
      where line.stage_result_id = new.id
    ) <> 5 then
      raise exception 'A final stage result requires five result lines.';
    end if;

    if (
      select count(*)
      from public.grandtour_stage_jersey_holders holder
      where holder.stage_id = new.stage_id
    ) <> 4 then
      raise exception 'A final stage result requires all four jersey holders.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create function grandtour_private.prepare_stage_score()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select
    tip.user_id,
    tip.competition_id,
    tip.stage_id,
    tip.tip_mode
  into
    new.user_id,
    new.competition_id,
    new.stage_id,
    new.tip_mode
  from public.grandtour_tips tip
  where tip.id = new.tip_id;

  if new.user_id is null then
    raise exception 'Stage score requires a valid tip.';
  end if;

  if not exists (
    select 1
    from public.grandtour_stage_results result
    where result.stage_id = new.stage_id
      and result.is_final
  ) then
    raise exception 'Stage score requires a final stage result.';
  end if;

  new.scored_at := now();
  return new;
end;
$$;

create trigger grandtour_riders_validate_team
before insert or update of grand_tour_id, team_id
on public.grandtour_riders
for each row execute function grandtour_private.validate_rider_team();

create trigger grandtour_startlists_validate_entry
before insert or update of stage_id, rider_id
on public.grandtour_stage_startlists
for each row execute function grandtour_private.validate_startlist_entry();

create trigger grandtour_tips_prepare
before insert or update
on public.grandtour_tips
for each row execute function grandtour_private.prepare_tip();

create trigger grandtour_tip_selections_validate
before insert or update of tip_id, rider_id
on public.grandtour_tip_selections
for each row execute function grandtour_private.validate_tip_selection();

create trigger grandtour_stage_results_validate_final
before insert or update
on public.grandtour_stage_results
for each row execute function grandtour_private.validate_final_result();

create trigger grandtour_stage_result_lines_validate
before insert or update
on public.grandtour_stage_result_lines
for each row execute function grandtour_private.validate_result_line();

create trigger grandtour_stage_result_lines_prevent_final_delete
before delete
on public.grandtour_stage_result_lines
for each row execute function grandtour_private.prevent_final_result_line_delete();

create trigger grandtour_stage_jersey_holders_validate
before insert or update
on public.grandtour_stage_jersey_holders
for each row execute function grandtour_private.validate_jersey_holder();

create trigger grandtour_stage_jersey_holders_prevent_final_delete
before delete
on public.grandtour_stage_jersey_holders
for each row execute function grandtour_private.prevent_final_jersey_holder_delete();

create trigger grandtour_stage_scores_prepare
before insert or update
on public.grandtour_stage_scores
for each row execute function grandtour_private.prepare_stage_score();

-- RLS is enabled on every table in the exposed public schema.
alter table public.grand_tours enable row level security;
alter table public.grandtour_competitions enable row level security;
alter table public.grandtour_teams enable row level security;
alter table public.grandtour_riders enable row level security;
alter table public.grandtour_stages enable row level security;
alter table public.grandtour_stage_startlists enable row level security;
alter table public.grandtour_tips enable row level security;
alter table public.grandtour_tip_selections enable row level security;
alter table public.grandtour_stage_results enable row level security;
alter table public.grandtour_stage_result_lines enable row level security;
alter table public.grandtour_stage_jersey_holders enable row level security;
alter table public.grandtour_stage_scores enable row level security;
alter table public.grandtour_leaderboard_snapshots enable row level security;

create policy "Public can read GrandTour tours"
on public.grand_tours for select
to anon, authenticated
using (true);

create policy "Public can read public GrandTour competitions"
on public.grandtour_competitions for select
to anon, authenticated
using (is_public);

create policy "Public can read GrandTour teams"
on public.grandtour_teams for select
to anon, authenticated
using (true);

create policy "Public can read GrandTour riders"
on public.grandtour_riders for select
to anon, authenticated
using (true);

create policy "Public can read GrandTour stages"
on public.grandtour_stages for select
to anon, authenticated
using (true);

create policy "Public can read GrandTour start lists"
on public.grandtour_stage_startlists for select
to anon, authenticated
using (true);

create policy "Public can read final GrandTour stage results"
on public.grandtour_stage_results for select
to anon, authenticated
using (is_final);

create policy "Public can read final GrandTour result lines"
on public.grandtour_stage_result_lines for select
to anon, authenticated
using (
  exists (
    select 1
    from public.grandtour_stage_results result
    where result.id = grandtour_stage_result_lines.stage_result_id
      and result.is_final
  )
);

create policy "Public can read final GrandTour jersey holders"
on public.grandtour_stage_jersey_holders for select
to anon, authenticated
using (
  exists (
    select 1
    from public.grandtour_stage_results result
    where result.stage_id = grandtour_stage_jersey_holders.stage_id
      and result.is_final
  )
);

create policy "Users can read their own GrandTour tips"
on public.grandtour_tips for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their own unlocked GrandTour tips"
on public.grandtour_tips for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and status = 'draft'
  and submitted_at is null
  and locked_at is null
  and total_score = 0
  and exists (
    select 1
    from public.grandtour_competitions competition
    join public.grandtour_stages stage
      on stage.grand_tour_id = competition.grand_tour_id
    join public.grand_tours tour on tour.id = competition.grand_tour_id
    where competition.id = grandtour_tips.competition_id
      and stage.id = grandtour_tips.stage_id
      and competition.is_public
      and (
        (
          grandtour_tips.tip_mode = 'preselection'
          and competition.allow_preselection
          and now() < tour.preselection_locks_at
        )
        or
        (
          grandtour_tips.tip_mode = 'daily'
          and competition.allow_daily
          and now() < stage.locks_at
        )
      )
  )
);

create policy "Users can update their own unlocked GrandTour tips"
on public.grandtour_tips for update
to authenticated
using (
  (select auth.uid()) = user_id
  and status in ('draft', 'submitted')
  and exists (
    select 1
    from public.grandtour_competitions competition
    join public.grandtour_stages stage
      on stage.grand_tour_id = competition.grand_tour_id
    join public.grand_tours tour on tour.id = competition.grand_tour_id
    where competition.id = grandtour_tips.competition_id
      and stage.id = grandtour_tips.stage_id
      and competition.is_public
      and (
        (
          grandtour_tips.tip_mode = 'preselection'
          and competition.allow_preselection
          and now() < tour.preselection_locks_at
        )
        or
        (
          grandtour_tips.tip_mode = 'daily'
          and competition.allow_daily
          and now() < stage.locks_at
        )
      )
  )
)
with check (
  (select auth.uid()) = user_id
  and status in ('draft', 'submitted')
  and locked_at is null
  and total_score = 0
  and exists (
    select 1
    from public.grandtour_competitions competition
    join public.grandtour_stages stage
      on stage.grand_tour_id = competition.grand_tour_id
    join public.grand_tours tour on tour.id = competition.grand_tour_id
    where competition.id = grandtour_tips.competition_id
      and stage.id = grandtour_tips.stage_id
      and competition.is_public
      and (
        (
          grandtour_tips.tip_mode = 'preselection'
          and competition.allow_preselection
          and now() < tour.preselection_locks_at
        )
        or
        (
          grandtour_tips.tip_mode = 'daily'
          and competition.allow_daily
          and now() < stage.locks_at
        )
      )
  )
);

create policy "Users can read their own GrandTour selections"
on public.grandtour_tip_selections for select
to authenticated
using (
  exists (
    select 1
    from public.grandtour_tips tip
    where tip.id = grandtour_tip_selections.tip_id
      and tip.user_id = (select auth.uid())
  )
);

create policy "Users can insert selections for their own unlocked draft"
on public.grandtour_tip_selections for insert
to authenticated
with check (
  exists (
    select 1
    from public.grandtour_tips tip
    join public.grandtour_competitions competition
      on competition.id = tip.competition_id
    join public.grandtour_stages stage
      on stage.id = tip.stage_id
     and stage.grand_tour_id = competition.grand_tour_id
    join public.grand_tours tour on tour.id = competition.grand_tour_id
    where tip.id = grandtour_tip_selections.tip_id
      and tip.user_id = (select auth.uid())
      and tip.status = 'draft'
      and competition.is_public
      and (
        (
          tip.tip_mode = 'preselection'
          and competition.allow_preselection
          and now() < tour.preselection_locks_at
        )
        or
        (
          tip.tip_mode = 'daily'
          and competition.allow_daily
          and now() < stage.locks_at
        )
      )
  )
);

create policy "Users can update selections for their own unlocked draft"
on public.grandtour_tip_selections for update
to authenticated
using (
  exists (
    select 1
    from public.grandtour_tips tip
    join public.grandtour_competitions competition
      on competition.id = tip.competition_id
    join public.grandtour_stages stage
      on stage.id = tip.stage_id
     and stage.grand_tour_id = competition.grand_tour_id
    join public.grand_tours tour on tour.id = competition.grand_tour_id
    where tip.id = grandtour_tip_selections.tip_id
      and tip.user_id = (select auth.uid())
      and tip.status = 'draft'
      and competition.is_public
      and (
        (
          tip.tip_mode = 'preselection'
          and competition.allow_preselection
          and now() < tour.preselection_locks_at
        )
        or
        (
          tip.tip_mode = 'daily'
          and competition.allow_daily
          and now() < stage.locks_at
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.grandtour_tips tip
    join public.grandtour_competitions competition
      on competition.id = tip.competition_id
    join public.grandtour_stages stage
      on stage.id = tip.stage_id
     and stage.grand_tour_id = competition.grand_tour_id
    join public.grand_tours tour on tour.id = competition.grand_tour_id
    where tip.id = grandtour_tip_selections.tip_id
      and tip.user_id = (select auth.uid())
      and tip.status = 'draft'
      and competition.is_public
      and (
        (
          tip.tip_mode = 'preselection'
          and competition.allow_preselection
          and now() < tour.preselection_locks_at
        )
        or
        (
          tip.tip_mode = 'daily'
          and competition.allow_daily
          and now() < stage.locks_at
        )
      )
  )
);

create policy "Users can delete selections from their own unlocked draft"
on public.grandtour_tip_selections for delete
to authenticated
using (
  exists (
    select 1
    from public.grandtour_tips tip
    join public.grandtour_competitions competition
      on competition.id = tip.competition_id
    join public.grandtour_stages stage
      on stage.id = tip.stage_id
     and stage.grand_tour_id = competition.grand_tour_id
    join public.grand_tours tour on tour.id = competition.grand_tour_id
    where tip.id = grandtour_tip_selections.tip_id
      and tip.user_id = (select auth.uid())
      and tip.status = 'draft'
      and competition.is_public
      and (
        (
          tip.tip_mode = 'preselection'
          and competition.allow_preselection
          and now() < tour.preselection_locks_at
        )
        or
        (
          tip.tip_mode = 'daily'
          and competition.allow_daily
          and now() < stage.locks_at
        )
      )
  )
);

create policy "Users can read their own GrandTour scores"
on public.grandtour_stage_scores for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their own GrandTour leaderboard rows"
on public.grandtour_leaderboard_snapshots for select
to authenticated
using ((select auth.uid()) = user_id);

-- Admin authority comes from the protected profiles.is_admin column, never user metadata.
create policy "Admins can read all GrandTour tips"
on public.grandtour_tips for select
to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.is_admin
  )
);

create policy "Admins can read all GrandTour selections"
on public.grandtour_tip_selections for select
to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.is_admin
  )
);

create policy "Admins can manage GrandTour stage results"
on public.grandtour_stage_results for all
to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.is_admin
  )
)
with check (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.is_admin
  )
);

create policy "Admins can manage GrandTour result lines"
on public.grandtour_stage_result_lines for all
to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.is_admin
  )
)
with check (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.is_admin
  )
);

create policy "Admins can manage GrandTour jersey holders"
on public.grandtour_stage_jersey_holders for all
to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.is_admin
  )
)
with check (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.is_admin
  )
);

create policy "Admins can manage GrandTour scores"
on public.grandtour_stage_scores for all
to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.is_admin
  )
)
with check (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.is_admin
  )
);

create policy "Admins can manage GrandTour leaderboard snapshots"
on public.grandtour_leaderboard_snapshots for all
to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.is_admin
  )
)
with check (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.is_admin
  )
);

-- Data API grants are explicit and intentionally narrower than service-role access.
grant select on table
  public.grand_tours,
  public.grandtour_competitions,
  public.grandtour_teams,
  public.grandtour_riders,
  public.grandtour_stages,
  public.grandtour_stage_startlists,
  public.grandtour_stage_results,
  public.grandtour_stage_result_lines,
  public.grandtour_stage_jersey_holders
to anon, authenticated;

grant select on table
  public.grandtour_tips,
  public.grandtour_tip_selections,
  public.grandtour_stage_scores,
  public.grandtour_leaderboard_snapshots
to authenticated;

grant insert (id, user_id, competition_id, stage_id, tip_mode, status)
on table public.grandtour_tips to authenticated;
grant update (status)
on table public.grandtour_tips to authenticated;

grant insert (tip_id, selection_type, rider_id, predicted_position)
on table public.grandtour_tip_selections to authenticated;
grant update (rider_id, predicted_position)
on table public.grandtour_tip_selections to authenticated;
grant delete on table public.grandtour_tip_selections to authenticated;

grant insert, update, delete on table
  public.grandtour_stage_results,
  public.grandtour_stage_result_lines,
  public.grandtour_stage_jersey_holders,
  public.grandtour_stage_scores,
  public.grandtour_leaderboard_snapshots
to authenticated;

grant all privileges on table
  public.grand_tours,
  public.grandtour_competitions,
  public.grandtour_teams,
  public.grandtour_riders,
  public.grandtour_stages,
  public.grandtour_stage_startlists,
  public.grandtour_tips,
  public.grandtour_tip_selections,
  public.grandtour_stage_results,
  public.grandtour_stage_result_lines,
  public.grandtour_stage_jersey_holders,
  public.grandtour_stage_scores,
  public.grandtour_leaderboard_snapshots
to service_role;
