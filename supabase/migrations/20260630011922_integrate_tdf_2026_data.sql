-- Extend the existing GrandTour model with source provenance and provisional
-- roster metadata. Generic/F1-era tables remain unchanged.

alter table public.grand_tours
  add column sport text not null default 'cycling',
  add column category text,
  add column countries text[] not null default '{}'::text[],
  add column source_url text,
  add column data_confidence text not null default 'medium',
  add column updated_at timestamptz not null default now();

alter table public.grand_tours
  add constraint grand_tours_data_confidence_check
  check (data_confidence in ('low', 'medium', 'high'));

alter table public.grandtour_teams
  add column code text,
  add column country text,
  add column team_type text,
  add column source_url text,
  add column data_confidence text not null default 'medium',
  add column updated_at timestamptz not null default now();

alter table public.grandtour_teams
  add constraint grandtour_teams_data_confidence_check
  check (data_confidence in ('low', 'medium', 'high'));

create unique index grandtour_teams_code_uidx
on public.grandtour_teams (grand_tour_id, code)
where code is not null and code <> '';

alter table public.grandtour_riders
  add column normalized_name text,
  add column nationality text,
  add column date_of_birth date,
  add column source_url text,
  add column data_confidence text not null default 'medium',
  add column updated_at timestamptz not null default now();

update public.grandtour_riders
set normalized_name = lower(regexp_replace(trim(display_name), '\s+', ' ', 'g'))
where normalized_name is null;

alter table public.grandtour_riders
  alter column normalized_name set not null,
  add constraint grandtour_riders_data_confidence_check
  check (data_confidence in ('low', 'medium', 'high'));

create unique index grandtour_riders_normalized_name_uidx
on public.grandtour_riders (grand_tour_id, normalized_name);

alter table public.grandtour_stages
  add column source_url text,
  add column data_confidence text not null default 'medium',
  add column start_time_is_estimated boolean not null default false,
  add column updated_at timestamptz not null default now();

alter table public.grandtour_stages
  add constraint grandtour_stages_data_confidence_check
  check (data_confidence in ('low', 'medium', 'high'));

create index grandtour_stages_starts_at_idx
on public.grandtour_stages (starts_at);

alter table public.grandtour_stage_startlists
  add column team_id uuid references public.grandtour_teams(id) on delete set null,
  add column status text not null default 'provisional',
  add column bib_number int,
  add column rider_role text,
  add column source_url text,
  add column data_confidence text not null default 'medium',
  add column updated_at timestamptz not null default now();

alter table public.grandtour_stage_startlists
  add constraint grandtour_stage_startlists_status_check
  check (status in ('provisional', 'confirmed', 'withdrawn', 'reserve', 'dns', 'dnf', 'unknown')),
  add constraint grandtour_stage_startlists_bib_number_check
  check (bib_number is null or bib_number > 0),
  add constraint grandtour_stage_startlists_data_confidence_check
  check (data_confidence in ('low', 'medium', 'high'));

create index grandtour_stage_startlists_team_id_idx
on public.grandtour_stage_startlists (team_id);

create index grandtour_stage_startlists_selectable_idx
on public.grandtour_stage_startlists (stage_id, status, rider_id);

alter table public.grandtour_tips
  add column is_dummy boolean not null default false;

create index grandtour_tips_dummy_idx
on public.grandtour_tips (is_dummy)
where is_dummy;

create table public.data_audit (
  id uuid primary key default gen_random_uuid(),
  grand_tour_id uuid references public.grand_tours(id) on delete cascade,
  source_name text not null,
  source_url text not null,
  date_accessed date not null,
  fields_found text[] not null default '{}'::text[],
  missing_fields text[] not null default '{}'::text[],
  confidence_notes text,
  data_confidence text not null default 'medium',
  reuse_risk text not null default 'medium',
  comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_url, date_accessed),
  check (data_confidence in ('low', 'medium', 'high')),
  check (reuse_risk in ('low', 'medium', 'high'))
);

create index data_audit_grand_tour_id_idx
on public.data_audit (grand_tour_id);

-- The original GrandTour game only needs the top five. Stage-winner v1 awards
-- one point through tenth place, so result entry may now store either a top-five
-- or full top-ten classification without changing the canonical top-five score.
alter table public.grandtour_stage_result_lines
  drop constraint grandtour_stage_result_lines_actual_position_check,
  add constraint grandtour_stage_result_lines_actual_position_check
  check (actual_position between 1 and 10);

create or replace function grandtour_private.validate_startlist_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_grand_tour_id uuid;
begin
  select stage.grand_tour_id
  into selected_grand_tour_id
  from public.grandtour_stages stage
  join public.grandtour_riders rider
    on rider.id = new.rider_id
   and rider.grand_tour_id = stage.grand_tour_id
  where stage.id = new.stage_id;

  if selected_grand_tour_id is null then
    raise exception 'Start-list rider and stage must belong to the same grand tour.';
  end if;

  if new.team_id is not null and not exists (
    select 1
    from public.grandtour_teams team
    where team.id = new.team_id
      and team.grand_tour_id = selected_grand_tour_id
  ) then
    raise exception 'Start-list team must belong to the same grand tour.';
  end if;

  return new;
end;
$$;

drop trigger grandtour_startlists_validate_entry
on public.grandtour_stage_startlists;

create trigger grandtour_startlists_validate_entry
before insert or update of stage_id, rider_id, team_id
on public.grandtour_stage_startlists
for each row execute function grandtour_private.validate_startlist_entry();

-- New selections must use a currently selectable stage roster entry. Existing
-- tips remain intact if a rider is subsequently withdrawn, DNS or DNF.
create or replace function grandtour_private.validate_tip_selection()
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
   and rider.is_active
  where tip.id = new.tip_id;

  if selected_stage_id is null then
    raise exception 'Selected rider must be active and belong to the tip grand tour.';
  end if;

  if not exists (
    select 1
    from public.grandtour_stage_startlists startlist
    where startlist.stage_id = selected_stage_id
      and startlist.rider_id = new.rider_id
      and startlist.status in ('provisional', 'confirmed')
  ) then
    raise exception 'Selected rider must be selectable on the stage start list.';
  end if;

  return new;
end;
$$;

create or replace function grandtour_private.validate_final_result()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  result_line_count int;
begin
  if new.is_final and (tg_op = 'INSERT' or old.is_final is distinct from new.is_final) then
    select count(*)
    into result_line_count
    from public.grandtour_stage_result_lines line
    where line.stage_result_id = new.id;

    if result_line_count not in (5, 10) then
      raise exception 'A final stage result requires five or ten result lines.';
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

alter table public.data_audit enable row level security;

create policy "Public can read GrandTour data audit"
on public.data_audit for select
to anon, authenticated
using (true);

create policy "Admins can manage GrandTour data audit"
on public.data_audit for all
to authenticated
using (
  exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.is_admin
  )
)
with check (
  exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.is_admin
  )
);

grant select on table public.data_audit to anon, authenticated;
grant insert, update, delete on table public.data_audit to authenticated;
grant all privileges on table public.data_audit to service_role;

-- The existing base-data policies are read-only for clients. Import and
-- refresh jobs use the server-side service role; no secret is shipped to Expo.
grant all privileges on table
  public.grand_tours,
  public.grandtour_teams,
  public.grandtour_riders,
  public.grandtour_stages,
  public.grandtour_stage_startlists
to service_role;
