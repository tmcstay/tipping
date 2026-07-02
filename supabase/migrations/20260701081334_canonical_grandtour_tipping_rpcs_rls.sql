-- Canonical GrandTour tipping workflow. This migration evolves the existing
-- model in place and deliberately keeps the legacy generic tables intact.

alter table public.grandtour_tips
  add column tip_scope public.grandtour_tip_scope not null default 'stage';

alter table public.grandtour_tips
  alter column stage_id drop not null,
  add constraint grandtour_tips_scope_stage_check check (
    (tip_scope = 'stage' and stage_id is not null)
    or
    (tip_scope = 'overall_jerseys' and stage_id is null and tip_mode = 'preselection')
  );

alter table public.grandtour_tips
  add constraint grandtour_tips_canonical_score_limit_check check (
    (tip_scope = 'stage' and total_score between 0 and 50)
    or
    (tip_scope = 'overall_jerseys' and total_score between 0 and 100)
  ) not valid;

create unique index grandtour_tips_stage_scope_uidx
on public.grandtour_tips (
  user_id, competition_id, stage_id, tip_mode, tip_scope
)
where tip_scope = 'stage';

create unique index grandtour_tips_overall_scope_uidx
on public.grandtour_tips (
  user_id, competition_id, tip_mode, tip_scope
)
where tip_scope = 'overall_jerseys';

alter table public.grandtour_competitions
  add column competition_id uuid unique
    references public.competitions(id) on delete restrict,
  add column active_jersey_types public.grandtour_jersey_type[] not null
    default array['yellow', 'green', 'kom', 'white']::public.grandtour_jersey_type[];

with cycling_app as (
  select id from public.apps where code = 'cycling' limit 1
)
insert into public.competitions (
  app_id,
  competition_key,
  name,
  sport_type,
  season,
  starts_at,
  ends_at,
  is_active,
  is_public
)
select
  cycling_app.id,
  'grandtour-' || grandtour_competition.id::text,
  grandtour_competition.name,
  'cycling',
  tour.year::text,
  tour.starts_at,
  tour.ends_at,
  true,
  grandtour_competition.is_public
from public.grandtour_competitions grandtour_competition
join public.grand_tours tour
  on tour.id = grandtour_competition.grand_tour_id
cross join cycling_app
on conflict (app_id, competition_key) do update
set
  name = excluded.name,
  season = excluded.season,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  is_public = excluded.is_public;

update public.grandtour_competitions grandtour_competition
set competition_id = competition.id
from public.competitions competition
join public.apps app on app.id = competition.app_id
where grandtour_competition.competition_id is null
  and app.code = 'cycling'
  and competition.competition_key =
    'grandtour-' || grandtour_competition.id::text;

alter table public.grandtour_competitions
  alter column competition_id set not null;

alter table public.competition_memberships
  add column status text not null default 'active',
  add column invited_by uuid references public.profiles(id) on delete set null,
  add column joined_at timestamptz;

update public.competition_memberships
set joined_at = coalesce(joined_at, created_at)
where status = 'active';

alter table public.competition_memberships
  add constraint competition_memberships_status_check
  check (status in ('invited', 'active', 'removed'));

create index competition_memberships_active_lookup_idx
on public.competition_memberships (competition_id, user_id)
where status = 'active';

alter table public.grand_tours
  add column manual_locked_at timestamptz,
  add column manual_locked_by uuid references public.profiles(id) on delete set null,
  add column manual_lock_reason text;

alter table public.grandtour_stages
  add column manual_locked_at timestamptz,
  add column manual_locked_by uuid references public.profiles(id) on delete set null,
  add column manual_lock_reason text;

alter table public.grandtour_stage_scores
  add column tip_scope public.grandtour_tip_scope not null default 'stage',
  add column is_prize_eligible boolean not null default true;

alter table public.grandtour_stage_scores
  drop constraint grandtour_stage_scores_jersey_score_check,
  add constraint grandtour_stage_scores_jersey_score_check check (
    (tip_scope = 'stage' and jersey_score between 0 and 20)
    or
    (tip_scope = 'overall_jerseys' and jersey_score between 0 and 100)
  );

alter table public.grandtour_stage_scores
  add constraint grandtour_stage_scores_canonical_breakdown_check check (
    top5_score between 0 and 30
    and bonus_score = 0
    and (
      (tip_scope = 'stage' and total_score between 0 and 50)
      or
      (tip_scope = 'overall_jerseys' and total_score between 0 and 100)
    )
  ) not valid;

alter table public.grandtour_leaderboard_snapshots
  add column is_dummy boolean not null default false,
  add column is_prize_eligible boolean not null default true;

alter table public.grandtour_leaderboard_snapshots
  add constraint grandtour_leaderboard_canonical_last_stage_check
  check (last_stage_score is null or last_stage_score between 0 and 50)
  not valid;

update public.grandtour_stage_scores score
set is_prize_eligible = not profile.is_dummy
from public.profiles profile
where profile.id = score.user_id;

update public.grandtour_leaderboard_snapshots snapshot
set
  is_dummy = profile.is_dummy,
  is_prize_eligible = not profile.is_dummy
from public.profiles profile
where profile.id = snapshot.user_id;

create table public.grandtour_game_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  competition_id uuid references public.grandtour_competitions(id) on delete set null,
  stage_id uuid references public.grandtour_stages(id) on delete set null,
  tip_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  request_id text,
  created_at timestamptz not null default now(),
  check (action in (
    'draft_saved',
    'tip_submitted',
    'tip_cleared',
    'tip_locked',
    'tip_voided',
    'tip_corrected',
    'result_finalised',
    'result_corrected',
    'score_calculated',
    'score_recalculated',
    'rider_auto_replaced',
    'lock_changed',
    'admin_override'
  ))
);

create index grandtour_game_audit_tip_created_idx
on public.grandtour_game_audit (tip_id, created_at desc);

create index grandtour_game_audit_competition_created_idx
on public.grandtour_game_audit (competition_id, created_at desc);

alter table public.grandtour_game_audit enable row level security;

create or replace function grandtour_private.is_cycling_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public_user.id is not null
  from (select (select auth.uid()) as id) public_user
  where exists (
    select 1
    from public.user_app_memberships membership
    join public.apps app on app.id = membership.app_id
    where membership.user_id = public_user.id
      and membership.status = 'active'
      and membership.role = 'admin'
      and app.code = 'cycling'
      and app.is_active
  );
$$;

create or replace function grandtour_private.can_access_competition(
  target_competition_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.grandtour_competitions grandtour_competition
    join public.competitions competition
      on competition.id = grandtour_competition.competition_id
    join public.apps app on app.id = competition.app_id
    join public.user_app_memberships app_membership
      on app_membership.app_id = app.id
     and app_membership.user_id = (select auth.uid())
     and app_membership.status = 'active'
    where grandtour_competition.id = target_competition_id
      and competition.is_active
      and app.is_active
      and (
        grandtour_competition.is_public
        or competition.is_public
        or app_membership.role = 'admin'
        or exists (
          select 1
          from public.competition_memberships membership
          where membership.competition_id = competition.id
            and membership.user_id = (select auth.uid())
            and membership.status = 'active'
        )
      )
  );
$$;

create or replace function grandtour_private.tip_lock_at(
  target_competition_id uuid,
  target_stage_id uuid,
  target_tip_mode public.grandtour_tip_mode,
  target_tip_scope public.grandtour_tip_scope
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when target_tip_scope = 'overall_jerseys'
      or target_tip_mode = 'preselection'
      then tour.preselection_locks_at
    when target_tip_scope = 'stage'
      and target_tip_mode = 'daily'
      then stage.locks_at
    else null
  end
  from public.grandtour_competitions competition
  join public.grand_tours tour on tour.id = competition.grand_tour_id
  left join public.grandtour_stages stage
    on stage.id = target_stage_id
   and stage.grand_tour_id = tour.id
  where competition.id = target_competition_id
    and (
      target_tip_scope = 'overall_jerseys'
      or stage.id is not null
    );
$$;

create or replace function grandtour_private.tip_is_locked(
  target_competition_id uuid,
  target_stage_id uuid,
  target_tip_mode public.grandtour_tip_mode,
  target_tip_scope public.grandtour_tip_scope
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      case
        when target_tip_scope = 'overall_jerseys'
          or target_tip_mode = 'preselection'
          then tour.manual_locked_at is not null
            or tour.preselection_locks_at is null
            or now() >= tour.preselection_locks_at
        when target_tip_scope = 'stage'
          and target_tip_mode = 'daily'
          then stage.id is null
            or stage.manual_locked_at is not null
            or stage.locks_at is null
            or now() >= stage.locks_at
        else true
      end
    from public.grandtour_competitions competition
    join public.grand_tours tour on tour.id = competition.grand_tour_id
    left join public.grandtour_stages stage
      on stage.id = target_stage_id
     and stage.grand_tour_id = tour.id
    where competition.id = target_competition_id
  ), true);
$$;

create or replace function grandtour_private.is_final_stage(target_stage_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.grandtour_stages stage
    where stage.id = target_stage_id
      and stage.stage_number = (
        select max(candidate.stage_number)
        from public.grandtour_stages candidate
        where candidate.grand_tour_id = stage.grand_tour_id
          and candidate.stage_type <> 'rest_day'
      )
  );
$$;

create or replace function grandtour_private.tip_is_complete(target_tip_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_scope public.grandtour_tip_scope;
  required_jerseys public.grandtour_jersey_type[];
  top_five_count int;
  jersey_count int;
begin
  select tip.tip_scope, competition.active_jersey_types
  into target_scope, required_jerseys
  from public.grandtour_tips tip
  join public.grandtour_competitions competition
    on competition.id = tip.competition_id
  where tip.id = target_tip_id;

  if target_scope is null then
    return false;
  end if;

  if target_scope = 'stage' then
    select count(*) into top_five_count
    from public.grandtour_tip_selections selection
    where selection.tip_id = target_tip_id
      and selection.selection_type = 'stage_top_5'
      and selection.predicted_position between 1 and 5;

    select count(*) into jersey_count
    from public.grandtour_tip_selections selection
    where selection.tip_id = target_tip_id
      and selection.selection_type = any (
        array[
          'yellow_holder', 'green_holder', 'kom_holder', 'white_holder'
        ]::public.grandtour_tip_selection_type[]
      )
      and case selection.selection_type
        when 'yellow_holder' then 'yellow'::public.grandtour_jersey_type
        when 'green_holder' then 'green'::public.grandtour_jersey_type
        when 'kom_holder' then 'kom'::public.grandtour_jersey_type
        when 'white_holder' then 'white'::public.grandtour_jersey_type
      end = any (required_jerseys);

    return top_five_count = 5
      and jersey_count = coalesce(cardinality(required_jerseys), 0);
  end if;

  select count(*) into jersey_count
  from public.grandtour_tip_selections selection
  where selection.tip_id = target_tip_id
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

revoke all on function grandtour_private.is_cycling_admin() from public;
revoke all on function grandtour_private.can_access_competition(uuid) from public;
revoke all on function grandtour_private.tip_lock_at(
  uuid, uuid, public.grandtour_tip_mode, public.grandtour_tip_scope
) from public;
revoke all on function grandtour_private.tip_is_locked(
  uuid, uuid, public.grandtour_tip_mode, public.grandtour_tip_scope
) from public;
revoke all on function grandtour_private.is_final_stage(uuid) from public;
revoke all on function grandtour_private.tip_is_complete(uuid) from public;

grant execute on function grandtour_private.is_cycling_admin() to authenticated;
grant execute on function grandtour_private.can_access_competition(uuid) to authenticated;
grant execute on function grandtour_private.tip_lock_at(
  uuid, uuid, public.grandtour_tip_mode, public.grandtour_tip_scope
) to authenticated;
grant execute on function grandtour_private.tip_is_locked(
  uuid, uuid, public.grandtour_tip_mode, public.grandtour_tip_scope
) to authenticated;
grant execute on function grandtour_private.is_final_stage(uuid) to authenticated;
grant execute on function grandtour_private.tip_is_complete(uuid) to authenticated;

create or replace function grandtour_private.prepare_tip()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  competition_allows_mode boolean;
  profile_is_dummy boolean;
begin
  select
    case
      when new.tip_mode = 'preselection' then competition.allow_preselection
      when new.tip_mode = 'daily' then competition.allow_daily
      else false
    end,
    profile.is_dummy
  into competition_allows_mode, profile_is_dummy
  from public.grandtour_competitions competition
  join public.grand_tours tour on tour.id = competition.grand_tour_id
  left join public.grandtour_stages stage
    on stage.id = new.stage_id
   and stage.grand_tour_id = tour.id
  join public.profiles profile on profile.id = new.user_id
  where competition.id = new.competition_id
    and (
      (new.tip_scope = 'stage' and stage.id is not null)
      or
      (new.tip_scope = 'overall_jerseys' and new.stage_id is null)
    );

  if competition_allows_mode is null then
    raise exception 'Competition, tip scope, and stage are inconsistent.';
  end if;

  if not competition_allows_mode then
    raise exception 'This competition does not allow the selected tip mode.';
  end if;

  new.is_dummy := profile_is_dummy;

  if new.status = 'submitted'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if grandtour_private.tip_is_locked(
      new.competition_id, new.stage_id, new.tip_mode, new.tip_scope
    ) then
      raise exception 'Tip submission is locked.';
    end if;

    if not grandtour_private.tip_is_complete(new.id) then
      raise exception 'A submitted tip requires every active selection.';
    end if;

    new.submitted_at := now();
  elsif new.status = 'draft' then
    new.submitted_at := null;
    new.locked_at := null;
    new.total_score := 0;
  elsif new.status = 'locked' then
    new.locked_at := coalesce(new.locked_at, now());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function grandtour_private.validate_tip_selection()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_stage_id uuid;
  selected_tour_id uuid;
  selected_scope public.grandtour_tip_scope;
  selected_mode public.grandtour_tip_mode;
  selected_competition_id uuid;
  active_jerseys public.grandtour_jersey_type[];
  selected_jersey public.grandtour_jersey_type;
  admin_override boolean;
begin
  select
    tip.stage_id,
    competition.grand_tour_id,
    tip.tip_scope,
    tip.tip_mode,
    tip.competition_id,
    competition.active_jersey_types
  into
    selected_stage_id,
    selected_tour_id,
    selected_scope,
    selected_mode,
    selected_competition_id,
    active_jerseys
  from public.grandtour_tips tip
  join public.grandtour_competitions competition
    on competition.id = tip.competition_id
  where tip.id = new.tip_id;

  if selected_scope is null or not exists (
    select 1
    from public.grandtour_riders rider
    where rider.id = new.rider_id
      and rider.grand_tour_id = selected_tour_id
      and rider.is_active
  ) then
    raise exception 'Selected rider must be active and belong to the tip tour.';
  end if;

  admin_override :=
    coalesce(current_setting('grandtour.admin_override', true), '') = 'on'
    and grandtour_private.is_cycling_admin();

  if grandtour_private.tip_is_locked(
    selected_competition_id,
    selected_stage_id,
    selected_mode,
    selected_scope
  ) and not admin_override then
    raise exception 'Tip selections are locked.';
  end if;

  if selected_scope = 'stage' then
    if new.selection_type = 'stage_top_5' then
      selected_jersey := null;
    else
      selected_jersey := case new.selection_type
        when 'yellow_holder' then 'yellow'::public.grandtour_jersey_type
        when 'green_holder' then 'green'::public.grandtour_jersey_type
        when 'kom_holder' then 'kom'::public.grandtour_jersey_type
        when 'white_holder' then 'white'::public.grandtour_jersey_type
        else null
      end;

      if selected_jersey is null or not selected_jersey = any (active_jerseys) then
        raise exception 'Selection type is not active for this stage competition.';
      end if;
    end if;

    if not admin_override and not exists (
      select 1
      from public.grandtour_stage_startlists startlist
      where startlist.stage_id = selected_stage_id
        and startlist.rider_id = new.rider_id
        and startlist.status in ('provisional', 'confirmed')
    ) then
      raise exception 'Selected rider must be selectable on the stage startlist.';
    end if;
  else
    selected_jersey := case new.selection_type
      when 'overall_yellow_winner' then 'yellow'::public.grandtour_jersey_type
      when 'overall_green_winner' then 'green'::public.grandtour_jersey_type
      when 'overall_kom_winner' then 'kom'::public.grandtour_jersey_type
      when 'overall_white_winner' then 'white'::public.grandtour_jersey_type
      else null
    end;

    if selected_jersey is null or not selected_jersey = any (active_jerseys) then
      raise exception 'Selection type is not active for overall jerseys.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function grandtour_private.guard_tip_selection_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  tip_row public.grandtour_tips%rowtype;
begin
  if coalesce(current_setting('grandtour.clearing_tip', true), '') = 'on' then
    return old;
  end if;

  select * into tip_row
  from public.grandtour_tips
  where id = old.tip_id;

  if grandtour_private.tip_is_locked(
    tip_row.competition_id,
    tip_row.stage_id,
    tip_row.tip_mode,
    tip_row.tip_scope
  ) and not (
    coalesce(current_setting('grandtour.admin_override', true), '') = 'on'
    and grandtour_private.is_cycling_admin()
  ) then
    raise exception 'Tip selections are locked.';
  end if;

  return old;
end;
$$;

create or replace function grandtour_private.prepare_stage_score()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select
    tip.user_id,
    tip.competition_id,
    coalesce(tip.stage_id, new.stage_id),
    tip.tip_mode,
    tip.tip_scope,
    not profile.is_dummy
  into
    new.user_id,
    new.competition_id,
    new.stage_id,
    new.tip_mode,
    new.tip_scope,
    new.is_prize_eligible
  from public.grandtour_tips tip
  join public.profiles profile on profile.id = tip.user_id
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

create or replace function grandtour_private.prepare_leaderboard_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select profile.is_dummy, not profile.is_dummy
  into new.is_dummy, new.is_prize_eligible
  from public.profiles profile
  where profile.id = new.user_id;

  if new.is_dummy is null then
    raise exception 'Leaderboard snapshot requires a valid profile.';
  end if;

  return new;
end;
$$;

drop trigger if exists grandtour_leaderboard_snapshots_prepare
on public.grandtour_leaderboard_snapshots;

create trigger grandtour_leaderboard_snapshots_prepare
before insert or update of user_id, is_dummy, is_prize_eligible
on public.grandtour_leaderboard_snapshots
for each row execute function grandtour_private.prepare_leaderboard_snapshot();

drop trigger if exists grandtour_tip_selections_guard_delete
on public.grandtour_tip_selections;

create trigger grandtour_tip_selections_guard_delete
before delete on public.grandtour_tip_selections
for each row execute function grandtour_private.guard_tip_selection_delete();

create or replace function grandtour_private.audit_tip_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
  audit_reason text;
  audit_request text;
  old_payload jsonb;
  new_payload jsonb;
  target_tip public.grandtour_tips%rowtype;
begin
  if coalesce(current_setting('grandtour.suppress_audit', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  target_tip := coalesce(new, old);
  audit_action := nullif(current_setting('grandtour.audit_action', true), '');
  audit_reason := nullif(current_setting('grandtour.audit_reason', true), '');
  audit_request := nullif(current_setting('grandtour.request_id', true), '');

  if audit_action is null then
    if tg_op = 'DELETE' then
      audit_action := 'tip_cleared';
    elsif new.status = 'submitted'
      and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      audit_action := 'tip_submitted';
    elsif new.status = 'locked'
      and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      audit_action := 'tip_locked';
    elsif new.status = 'scored' then
      audit_action := 'score_calculated';
    elsif new.status = 'draft' then
      audit_action := 'draft_saved';
    else
      audit_action := 'tip_corrected';
    end if;
  end if;

  if tg_op <> 'INSERT' then
    old_payload := to_jsonb(old) || jsonb_build_object(
      'selections', coalesce((
        select jsonb_agg(to_jsonb(selection) order by selection.selection_type, selection.predicted_position)
        from public.grandtour_tip_selections selection
        where selection.tip_id = old.id
      ), '[]'::jsonb)
    );
  end if;

  if tg_op <> 'DELETE' then
    new_payload := to_jsonb(new) || jsonb_build_object(
      'selections', coalesce((
        select jsonb_agg(to_jsonb(selection) order by selection.selection_type, selection.predicted_position)
        from public.grandtour_tip_selections selection
        where selection.tip_id = new.id
      ), '[]'::jsonb)
    );
  end if;

  insert into public.grandtour_game_audit (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    competition_id,
    stage_id,
    tip_id,
    old_value,
    new_value,
    reason,
    request_id
  ) values (
    (select auth.uid()),
    audit_action,
    'tip',
    target_tip.id,
    target_tip.competition_id,
    target_tip.stage_id,
    target_tip.id,
    old_payload,
    new_payload,
    audit_reason,
    audit_request
  );

  return coalesce(new, old);
end;
$$;

create trigger grandtour_tips_audit_insert_update
after insert or update on public.grandtour_tips
for each row execute function grandtour_private.audit_tip_mutation();

create trigger grandtour_tips_audit_delete
before delete on public.grandtour_tips
for each row execute function grandtour_private.audit_tip_mutation();

create or replace function grandtour_private.prevent_game_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'GrandTour gameplay audit rows are append-only.';
end;
$$;

create trigger grandtour_game_audit_append_only
before update or delete on public.grandtour_game_audit
for each row execute function grandtour_private.prevent_game_audit_change();

revoke all on function grandtour_private.audit_tip_mutation() from public, anon, authenticated;
revoke all on function grandtour_private.prevent_game_audit_change() from public, anon, authenticated;

create or replace function grandtour_private.audit_result_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_id uuid;
  target_stage_id uuid;
  audit_action text;
begin
  if tg_table_name = 'grandtour_stage_results' then
    result_id := coalesce(new.id, old.id);
    target_stage_id := coalesce(new.stage_id, old.stage_id);
    audit_action := case
      when tg_op <> 'DELETE'
        and new.is_final
        and (tg_op = 'INSERT' or old.is_final is distinct from new.is_final)
        then 'result_finalised'
      else 'result_corrected'
    end;
  elsif tg_table_name = 'grandtour_stage_result_lines' then
    result_id := coalesce(new.stage_result_id, old.stage_result_id);
    select result.stage_id into target_stage_id
    from public.grandtour_stage_results result
    where result.id = result_id;
    audit_action := 'result_corrected';
  else
    target_stage_id := coalesce(new.stage_id, old.stage_id);
    audit_action := 'result_corrected';
  end if;

  insert into public.grandtour_game_audit (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    stage_id,
    old_value,
    new_value,
    reason,
    request_id
  ) values (
    (select auth.uid()),
    audit_action,
    tg_table_name,
    coalesce(new.id, old.id),
    target_stage_id,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    nullif(current_setting('grandtour.audit_reason', true), ''),
    nullif(current_setting('grandtour.request_id', true), '')
  );

  return coalesce(new, old);
end;
$$;

create trigger grandtour_stage_results_audit
after insert or update or delete on public.grandtour_stage_results
for each row execute function grandtour_private.audit_result_mutation();

create trigger grandtour_stage_result_lines_audit
after insert or update or delete on public.grandtour_stage_result_lines
for each row execute function grandtour_private.audit_result_mutation();

create trigger grandtour_stage_jersey_holders_audit
after insert or update or delete on public.grandtour_stage_jersey_holders
for each row execute function grandtour_private.audit_result_mutation();

create or replace function grandtour_private.audit_lock_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.manual_locked_at is distinct from new.manual_locked_at
    or old.manual_locked_by is distinct from new.manual_locked_by
    or old.manual_lock_reason is distinct from new.manual_lock_reason then
    insert into public.grandtour_game_audit (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      stage_id,
      old_value,
      new_value,
      reason,
      request_id
    ) values (
      (select auth.uid()),
      'lock_changed',
      tg_table_name,
      new.id,
      case when tg_table_name = 'grandtour_stages' then new.id else null end,
      to_jsonb(old),
      to_jsonb(new),
      new.manual_lock_reason,
      nullif(current_setting('grandtour.request_id', true), '')
    );
  end if;
  return new;
end;
$$;

create trigger grand_tours_audit_lock
after update of manual_locked_at, manual_locked_by, manual_lock_reason
on public.grand_tours
for each row execute function grandtour_private.audit_lock_change();

create trigger grandtour_stages_audit_lock
after update of manual_locked_at, manual_locked_by, manual_lock_reason
on public.grandtour_stages
for each row execute function grandtour_private.audit_lock_change();

revoke all on function grandtour_private.audit_result_mutation() from public, anon, authenticated;
revoke all on function grandtour_private.audit_lock_change() from public, anon, authenticated;

create or replace function public.save_grandtour_tip_draft(
  p_competition_id uuid,
  p_stage_id uuid,
  p_tip_mode public.grandtour_tip_mode,
  p_tip_scope public.grandtour_tip_scope,
  p_selections jsonb,
  p_request_id text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  target_tip_id uuid;
  selection_record record;
  allowed_selection boolean;
begin
  if target_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not grandtour_private.can_access_competition(p_competition_id) then
    raise exception 'Competition membership is required.';
  end if;

  if grandtour_private.tip_is_locked(
    p_competition_id, p_stage_id, p_tip_mode, p_tip_scope
  ) then
    raise exception 'Tip editing is locked.';
  end if;

  if p_selections is null or jsonb_typeof(p_selections) <> 'array' then
    raise exception 'Selections must be a JSON array.';
  end if;

  if p_tip_scope = 'stage' and p_stage_id is null then
    raise exception 'Stage tips require a stage.';
  elsif p_tip_scope = 'overall_jerseys'
    and (p_stage_id is not null or p_tip_mode <> 'preselection') then
    raise exception 'Overall jersey tips are tour-level preselection tips.';
  end if;

  perform set_config('grandtour.request_id', coalesce(p_request_id, ''), true);
  perform set_config('grandtour.audit_action', 'draft_saved', true);
  perform set_config('grandtour.suppress_audit', 'on', true);

  select tip.id into target_tip_id
  from public.grandtour_tips tip
  where tip.user_id = target_user_id
    and tip.competition_id = p_competition_id
    and tip.tip_mode = p_tip_mode
    and tip.tip_scope = p_tip_scope
    and tip.stage_id is not distinct from p_stage_id
  for update;

  if target_tip_id is null then
    target_tip_id := gen_random_uuid();
    insert into public.grandtour_tips (
      id,
      user_id,
      competition_id,
      stage_id,
      tip_mode,
      tip_scope,
      status
    ) values (
      target_tip_id,
      target_user_id,
      p_competition_id,
      p_stage_id,
      p_tip_mode,
      p_tip_scope,
      'draft'
    );
  else
    update public.grandtour_tips
    set status = 'draft'
    where id = target_tip_id;
  end if;

  delete from public.grandtour_tip_selections
  where tip_id = target_tip_id;

  for selection_record in
    select *
    from jsonb_to_recordset(p_selections) as selection_payload(
      selection_type text,
      rider_id uuid,
      predicted_position int
    )
  loop
    allowed_selection := case
      when p_tip_scope = 'stage' then
        selection_record.selection_type in (
          'stage_top_5',
          'yellow_holder',
          'green_holder',
          'kom_holder',
          'white_holder'
        )
      else
        selection_record.selection_type in (
          'overall_yellow_winner',
          'overall_green_winner',
          'overall_kom_winner',
          'overall_white_winner'
        )
    end;

    if not allowed_selection
      or selection_record.selection_type is null
      or selection_record.rider_id is null then
      raise exception 'Draft contains an invalid selection.';
    end if;

    insert into public.grandtour_tip_selections (
      tip_id,
      selection_type,
      rider_id,
      predicted_position
    ) values (
      target_tip_id,
      selection_record.selection_type::public.grandtour_tip_selection_type,
      selection_record.rider_id,
      selection_record.predicted_position
    );
  end loop;

  perform set_config('grandtour.suppress_audit', 'off', true);
  update public.grandtour_tips
  set updated_at = now()
  where id = target_tip_id;

  return target_tip_id;
end;
$$;

create or replace function public.submit_grandtour_tip(
  p_tip_id uuid,
  p_request_id text default null
)
returns public.grandtour_tips
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_tip public.grandtour_tips%rowtype;
begin
  select * into target_tip
  from public.grandtour_tips
  where id = p_tip_id
    and user_id = (select auth.uid());

  if target_tip.id is null then
    raise exception 'Tip was not found.';
  end if;

  if not grandtour_private.can_access_competition(target_tip.competition_id) then
    raise exception 'Competition membership is required.';
  end if;

  if grandtour_private.tip_is_locked(
    target_tip.competition_id,
    target_tip.stage_id,
    target_tip.tip_mode,
    target_tip.tip_scope
  ) then
    raise exception 'Tip submission is locked.';
  end if;

  if not grandtour_private.tip_is_complete(target_tip.id) then
    raise exception 'Tip is incomplete.';
  end if;

  perform set_config('grandtour.request_id', coalesce(p_request_id, ''), true);
  perform set_config('grandtour.audit_action', 'tip_submitted', true);

  update public.grandtour_tips
  set status = 'submitted'
  where id = target_tip.id
  returning * into target_tip;

  return target_tip;
end;
$$;

create or replace function public.clear_grandtour_tip_draft(
  p_tip_id uuid,
  p_reason text default null,
  p_request_id text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_tip public.grandtour_tips%rowtype;
begin
  select * into target_tip
  from public.grandtour_tips
  where id = p_tip_id
    and user_id = (select auth.uid());

  if target_tip.id is null then
    return false;
  end if;

  if grandtour_private.tip_is_locked(
    target_tip.competition_id,
    target_tip.stage_id,
    target_tip.tip_mode,
    target_tip.tip_scope
  ) then
    raise exception 'Tip clearing is locked.';
  end if;

  perform set_config('grandtour.request_id', coalesce(p_request_id, ''), true);
  perform set_config('grandtour.audit_reason', coalesce(p_reason, ''), true);
  perform set_config('grandtour.audit_action', 'tip_cleared', true);
  perform set_config('grandtour.clearing_tip', 'on', true);

  delete from public.grandtour_tips
  where id = target_tip.id;

  return true;
end;
$$;

create or replace function public.lock_grandtour_stage_tips(
  p_stage_id uuid,
  p_reason text,
  p_request_id text default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected_count integer;
begin
  if not grandtour_private.is_cycling_admin() then
    raise exception 'GrandTour administrator access is required.';
  end if;

  if not exists (
    select 1 from public.grandtour_stages where id = p_stage_id
  ) then
    raise exception 'Stage was not found.';
  end if;

  perform set_config('grandtour.request_id', coalesce(p_request_id, ''), true);
  perform set_config('grandtour.audit_reason', coalesce(p_reason, ''), true);
  perform set_config('grandtour.audit_action', 'tip_locked', true);
  perform set_config('grandtour.admin_override', 'on', true);

  update public.grandtour_stages
  set
    manual_locked_at = now(),
    manual_locked_by = (select auth.uid()),
    manual_lock_reason = p_reason
  where id = p_stage_id;

  update public.grandtour_tips
  set
    status = 'locked',
    locked_at = now()
  where stage_id = p_stage_id
    and status = 'submitted';

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

create or replace function public.recalculate_grandtour_stage_scores(
  p_stage_id uuid,
  p_reason text default null,
  p_request_id text default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tip_record record;
  top_five_points int;
  jersey_points int;
  total_points int;
  top_five_breakdown jsonb;
  jersey_breakdown jsonb;
  score_breakdown jsonb;
  affected_count int := 0;
  score_action text;
  eligible boolean;
  final_stage boolean;
begin
  if not grandtour_private.is_cycling_admin() then
    raise exception 'GrandTour administrator access is required.';
  end if;

  if not exists (
    select 1
    from public.grandtour_stage_results result
    where result.stage_id = p_stage_id
      and result.is_final
  ) then
    raise exception 'Scoring requires a final stage result.';
  end if;

  score_action := case when exists (
    select 1
    from public.grandtour_stage_scores score
    where score.stage_id = p_stage_id
  ) then 'score_recalculated' else 'score_calculated' end;

  final_stage := grandtour_private.is_final_stage(p_stage_id);

  perform set_config('grandtour.request_id', coalesce(p_request_id, ''), true);
  perform set_config('grandtour.audit_reason', coalesce(p_reason, ''), true);
  perform set_config('grandtour.audit_action', score_action, true);
  perform set_config('grandtour.admin_override', 'on', true);

  for tip_record in
    select tip.*
    from public.grandtour_tips tip
    join public.grandtour_competitions competition
      on competition.id = tip.competition_id
    join public.grandtour_stages stage
      on stage.id = p_stage_id
     and stage.grand_tour_id = competition.grand_tour_id
    where (
      tip.tip_scope = 'stage'
      and tip.stage_id = p_stage_id
    ) or (
      final_stage
      and tip.tip_scope = 'overall_jerseys'
      and tip.stage_id is null
    )
    order by tip.id
    for update of tip
  loop
    eligible := tip_record.status in ('submitted', 'locked', 'scored');
    top_five_points := 0;
    jersey_points := 0;
    top_five_breakdown := '[]'::jsonb;
    jersey_breakdown := '[]'::jsonb;

    if eligible and tip_record.tip_scope = 'stage' then
      select
        coalesce(sum(
          case
            when result_line.rider_id is null then 0
            when result_line.actual_position = selection.predicted_position then
              case selection.predicted_position
                when 1 then 10
                when 2 then 8
                when 3 then 6
                when 4 then 4
                when 5 then 2
                else 0
              end
            else 1
          end
        ), 0),
        coalesce(jsonb_agg(
          jsonb_build_object(
            'predicted_position', selection.predicted_position,
            'rider_id', selection.rider_id,
            'actual_position', result_line.actual_position,
            'points', case
              when result_line.rider_id is null then 0
              when result_line.actual_position = selection.predicted_position then
                case selection.predicted_position
                  when 1 then 10
                  when 2 then 8
                  when 3 then 6
                  when 4 then 4
                  when 5 then 2
                  else 0
                end
              else 1
            end
          ) order by selection.predicted_position
        ), '[]'::jsonb)
      into top_five_points, top_five_breakdown
      from public.grandtour_tip_selections selection
      left join public.grandtour_stage_results result
        on result.stage_id = p_stage_id
       and result.is_final
      left join public.grandtour_stage_result_lines result_line
        on result_line.stage_result_id = result.id
       and result_line.rider_id = selection.rider_id
       and result_line.actual_position between 1 and 5
      where selection.tip_id = tip_record.id
        and selection.selection_type = 'stage_top_5';

      select
        coalesce(sum(case when holder.rider_id = selection.rider_id then 5 else 0 end), 0),
        coalesce(jsonb_agg(
          jsonb_build_object(
            'selection_type', selection.selection_type,
            'predicted_rider_id', selection.rider_id,
            'actual_rider_id', holder.rider_id,
            'points', case when holder.rider_id = selection.rider_id then 5 else 0 end
          ) order by selection.selection_type
        ), '[]'::jsonb)
      into jersey_points, jersey_breakdown
      from public.grandtour_tip_selections selection
      left join public.grandtour_stage_jersey_holders holder
        on holder.stage_id = p_stage_id
       and holder.jersey_type = case selection.selection_type
         when 'yellow_holder' then 'yellow'::public.grandtour_jersey_type
         when 'green_holder' then 'green'::public.grandtour_jersey_type
         when 'kom_holder' then 'kom'::public.grandtour_jersey_type
         when 'white_holder' then 'white'::public.grandtour_jersey_type
       end
      where selection.tip_id = tip_record.id
        and selection.selection_type = any (
          array[
            'yellow_holder', 'green_holder', 'kom_holder', 'white_holder'
          ]::public.grandtour_tip_selection_type[]
        );
    elsif eligible and tip_record.tip_scope = 'overall_jerseys' and final_stage then
      select
        coalesce(sum(case when holder.rider_id = selection.rider_id then 25 else 0 end), 0),
        coalesce(jsonb_agg(
          jsonb_build_object(
            'selection_type', selection.selection_type,
            'predicted_rider_id', selection.rider_id,
            'actual_rider_id', holder.rider_id,
            'points', case when holder.rider_id = selection.rider_id then 25 else 0 end
          ) order by selection.selection_type
        ), '[]'::jsonb)
      into jersey_points, jersey_breakdown
      from public.grandtour_tip_selections selection
      left join public.grandtour_stage_jersey_holders holder
        on holder.stage_id = p_stage_id
       and holder.jersey_type = case selection.selection_type
         when 'overall_yellow_winner' then 'yellow'::public.grandtour_jersey_type
         when 'overall_green_winner' then 'green'::public.grandtour_jersey_type
         when 'overall_kom_winner' then 'kom'::public.grandtour_jersey_type
         when 'overall_white_winner' then 'white'::public.grandtour_jersey_type
       end
      where selection.tip_id = tip_record.id
        and selection.selection_type = any (
          array[
            'overall_yellow_winner',
            'overall_green_winner',
            'overall_kom_winner',
            'overall_white_winner'
          ]::public.grandtour_tip_selection_type[]
        );
    end if;

    total_points := case when eligible then top_five_points + jersey_points else 0 end;
    score_breakdown := jsonb_build_object(
      'tip_scope', tip_record.tip_scope,
      'eligible_status', eligible,
      'top_five', top_five_breakdown,
      'top_five_score', top_five_points,
      'jerseys', jersey_breakdown,
      'jersey_score', jersey_points,
      'total_score', total_points
    );

    insert into public.grandtour_stage_scores (
      tip_id,
      user_id,
      competition_id,
      stage_id,
      tip_mode,
      tip_scope,
      top5_score,
      jersey_score,
      bonus_score,
      total_score,
      score_details
    ) values (
      tip_record.id,
      tip_record.user_id,
      tip_record.competition_id,
      p_stage_id,
      tip_record.tip_mode,
      tip_record.tip_scope,
      top_five_points,
      jersey_points,
      0,
      total_points,
      score_breakdown
    )
    on conflict (tip_id) do update
    set
      stage_id = excluded.stage_id,
      top5_score = excluded.top5_score,
      jersey_score = excluded.jersey_score,
      bonus_score = excluded.bonus_score,
      total_score = excluded.total_score,
      score_details = excluded.score_details,
      scored_at = now();

    update public.grandtour_tips
    set
      total_score = total_points,
      status = case
        when eligible then 'scored'::public.grandtour_tip_status
        else 'draft'::public.grandtour_tip_status
      end
    where id = tip_record.id;

    affected_count := affected_count + 1;
  end loop;

  return affected_count;
end;
$$;

create or replace function public.score_grandtour_stage(
  p_stage_id uuid,
  p_request_id text default null
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select public.recalculate_grandtour_stage_scores(
    p_stage_id,
    'Initial canonical scoring',
    p_request_id
  );
$$;

drop policy if exists "Public can read public GrandTour competitions"
on public.grandtour_competitions;

create policy "Eligible users can read GrandTour competitions"
on public.grandtour_competitions for select
to anon, authenticated
using (
  is_public
  or (
    (select auth.uid()) is not null
    and grandtour_private.can_access_competition(id)
  )
);

create policy "Cycling admins can update GrandTour competitions"
on public.grandtour_competitions for update
to authenticated
using (grandtour_private.is_cycling_admin())
with check (grandtour_private.is_cycling_admin());

drop policy if exists "Authenticated users can read active competitions"
on public.competitions;

create policy "Eligible users can read active competitions"
on public.competitions for select
to authenticated
using (
  is_active
  and (
    is_public
    or (select app_private.has_app_role(app_id, array['admin', 'moderator']))
    or exists (
      select 1
      from public.competition_memberships membership
      where membership.competition_id = competitions.id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
  )
);

drop policy if exists "Users can insert their own unlocked GrandTour tips"
on public.grandtour_tips;
drop policy if exists "Users can update their own unlocked GrandTour tips"
on public.grandtour_tips;
drop policy if exists "Users can read their own GrandTour tips"
on public.grandtour_tips;
drop policy if exists "Admins can read all GrandTour tips"
on public.grandtour_tips;
drop policy if exists "Admins can read all GrandTour selections"
on public.grandtour_tip_selections;

create policy "Users can read own or post-lock eligible GrandTour tips"
on public.grandtour_tips for select
to authenticated
using (
  user_id = (select auth.uid())
  or grandtour_private.is_cycling_admin()
  or (
    status in ('submitted', 'locked', 'scored')
    and grandtour_private.tip_is_locked(
      competition_id, stage_id, tip_mode, tip_scope
    )
    and grandtour_private.can_access_competition(competition_id)
  )
);

create policy "Users can insert own unlocked GrandTour drafts"
on public.grandtour_tips for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'draft'
  and submitted_at is null
  and locked_at is null
  and total_score = 0
  and grandtour_private.can_access_competition(competition_id)
  and not grandtour_private.tip_is_locked(
    competition_id, stage_id, tip_mode, tip_scope
  )
);

create policy "Users can update own unlocked GrandTour tips"
on public.grandtour_tips for update
to authenticated
using (
  grandtour_private.is_cycling_admin()
  or (
    user_id = (select auth.uid())
    and status in ('draft', 'submitted')
    and grandtour_private.can_access_competition(competition_id)
    and not grandtour_private.tip_is_locked(
      competition_id, stage_id, tip_mode, tip_scope
    )
  )
)
with check (
  grandtour_private.is_cycling_admin()
  or (
    user_id = (select auth.uid())
    and status in ('draft', 'submitted')
    and locked_at is null
    and total_score = 0
    and grandtour_private.can_access_competition(competition_id)
    and not grandtour_private.tip_is_locked(
      competition_id, stage_id, tip_mode, tip_scope
    )
  )
);

create policy "Users can delete own unlocked GrandTour tips"
on public.grandtour_tips for delete
to authenticated
using (
  user_id = (select auth.uid())
  and status in ('draft', 'submitted')
  and grandtour_private.can_access_competition(competition_id)
  and not grandtour_private.tip_is_locked(
    competition_id, stage_id, tip_mode, tip_scope
  )
);

drop policy if exists "Users can read their own GrandTour selections"
on public.grandtour_tip_selections;
drop policy if exists "Users can insert selections for their own unlocked draft"
on public.grandtour_tip_selections;
drop policy if exists "Users can update selections for their own unlocked draft"
on public.grandtour_tip_selections;
drop policy if exists "Users can delete selections from their own unlocked draft"
on public.grandtour_tip_selections;

create policy "Users can read visible GrandTour selections"
on public.grandtour_tip_selections for select
to authenticated
using (
  exists (
    select 1
    from public.grandtour_tips tip
    where tip.id = grandtour_tip_selections.tip_id
      and (
        tip.user_id = (select auth.uid())
        or grandtour_private.is_cycling_admin()
        or (
          tip.status in ('submitted', 'locked', 'scored')
          and grandtour_private.tip_is_locked(
            tip.competition_id, tip.stage_id, tip.tip_mode, tip.tip_scope
          )
          and grandtour_private.can_access_competition(tip.competition_id)
        )
      )
  )
);

create policy "Users can insert own unlocked draft selections"
on public.grandtour_tip_selections for insert
to authenticated
with check (
  exists (
    select 1
    from public.grandtour_tips tip
    where tip.id = grandtour_tip_selections.tip_id
      and tip.user_id = (select auth.uid())
      and tip.status = 'draft'
      and grandtour_private.can_access_competition(tip.competition_id)
      and not grandtour_private.tip_is_locked(
        tip.competition_id, tip.stage_id, tip.tip_mode, tip.tip_scope
      )
  )
);

create policy "Users can update own unlocked draft selections"
on public.grandtour_tip_selections for update
to authenticated
using (
  exists (
    select 1
    from public.grandtour_tips tip
    where tip.id = grandtour_tip_selections.tip_id
      and tip.user_id = (select auth.uid())
      and tip.status = 'draft'
      and not grandtour_private.tip_is_locked(
        tip.competition_id, tip.stage_id, tip.tip_mode, tip.tip_scope
      )
  )
)
with check (
  exists (
    select 1
    from public.grandtour_tips tip
    where tip.id = grandtour_tip_selections.tip_id
      and tip.user_id = (select auth.uid())
      and tip.status = 'draft'
      and grandtour_private.can_access_competition(tip.competition_id)
      and not grandtour_private.tip_is_locked(
        tip.competition_id, tip.stage_id, tip.tip_mode, tip.tip_scope
      )
  )
);

create policy "Users can delete own unlocked draft selections"
on public.grandtour_tip_selections for delete
to authenticated
using (
  exists (
    select 1
    from public.grandtour_tips tip
    where tip.id = grandtour_tip_selections.tip_id
      and tip.user_id = (select auth.uid())
      and tip.status = 'draft'
      and grandtour_private.can_access_competition(tip.competition_id)
      and not grandtour_private.tip_is_locked(
        tip.competition_id, tip.stage_id, tip.tip_mode, tip.tip_scope
      )
  )
);

drop policy if exists "Users can read their own GrandTour scores"
on public.grandtour_stage_scores;
drop policy if exists "Admins can manage GrandTour scores"
on public.grandtour_stage_scores;

create policy "Users can read eligible GrandTour scores"
on public.grandtour_stage_scores for select
to authenticated
using (
  user_id = (select auth.uid())
  or grandtour_private.is_cycling_admin()
  or grandtour_private.can_access_competition(competition_id)
);

create policy "Cycling admins can insert GrandTour scores"
on public.grandtour_stage_scores for insert
to authenticated
with check (grandtour_private.is_cycling_admin());

create policy "Cycling admins can update GrandTour scores"
on public.grandtour_stage_scores for update
to authenticated
using (grandtour_private.is_cycling_admin())
with check (grandtour_private.is_cycling_admin());

create policy "Cycling admins can delete GrandTour scores"
on public.grandtour_stage_scores for delete
to authenticated
using (grandtour_private.is_cycling_admin());

drop policy if exists "Users can read their own GrandTour leaderboard rows"
on public.grandtour_leaderboard_snapshots;
drop policy if exists "Admins can manage GrandTour leaderboard snapshots"
on public.grandtour_leaderboard_snapshots;

create policy "Users can read eligible GrandTour leaderboard rows"
on public.grandtour_leaderboard_snapshots for select
to authenticated
using (
  user_id = (select auth.uid())
  or grandtour_private.is_cycling_admin()
  or grandtour_private.can_access_competition(competition_id)
);

create policy "Cycling admins can insert GrandTour leaderboard rows"
on public.grandtour_leaderboard_snapshots for insert
to authenticated
with check (grandtour_private.is_cycling_admin());

create policy "Cycling admins can update GrandTour leaderboard rows"
on public.grandtour_leaderboard_snapshots for update
to authenticated
using (grandtour_private.is_cycling_admin())
with check (grandtour_private.is_cycling_admin());

create policy "Cycling admins can delete GrandTour leaderboard rows"
on public.grandtour_leaderboard_snapshots for delete
to authenticated
using (grandtour_private.is_cycling_admin());

create policy "Users can read own GrandTour gameplay audit"
on public.grandtour_game_audit for select
to authenticated
using (
  actor_user_id = (select auth.uid())
  or grandtour_private.is_cycling_admin()
  or exists (
    select 1
    from public.grandtour_tips tip
    where tip.id = grandtour_game_audit.tip_id
      and tip.user_id = (select auth.uid())
  )
);

create policy "Cycling admins can update GrandTour stages"
on public.grandtour_stages for update
to authenticated
using (grandtour_private.is_cycling_admin())
with check (grandtour_private.is_cycling_admin());

create policy "Cycling admins can update GrandTour tours"
on public.grand_tours for update
to authenticated
using (grandtour_private.is_cycling_admin())
with check (grandtour_private.is_cycling_admin());

drop policy if exists "Users can read their own profile"
on public.profiles;

create policy "League viewers can read safe GrandTour profiles"
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
  or grandtour_private.is_cycling_admin()
  or exists (
    select 1
    from public.grandtour_tips tip
    where tip.user_id = profiles.id
      and tip.status in ('submitted', 'locked', 'scored')
      and grandtour_private.tip_is_locked(
        tip.competition_id, tip.stage_id, tip.tip_mode, tip.tip_scope
      )
      and grandtour_private.can_access_competition(tip.competition_id)
  )
);

create or replace view public.grandtour_league_profiles
with (security_invoker = true)
as
select id, display_name, avatar_url, is_dummy
from public.profiles;

create or replace view public.grandtour_prize_eligible_scores
with (security_invoker = true)
as
select score.*
from public.grandtour_stage_scores score
where score.is_prize_eligible;

revoke all privileges on table
  public.grandtour_tips,
  public.grandtour_tip_selections,
  public.grandtour_stage_scores,
  public.grandtour_leaderboard_snapshots,
  public.grandtour_game_audit
from anon, authenticated;

revoke all privileges on table
  public.grandtour_competitions,
  public.grand_tours,
  public.grandtour_stages
from anon, authenticated;

grant select on table
  public.grand_tours,
  public.grandtour_stages,
  public.grandtour_competitions
to anon, authenticated;

grant update on table
  public.grand_tours,
  public.grandtour_stages,
  public.grandtour_competitions
to authenticated;

grant select, insert, update, delete
on table public.grandtour_tips
to authenticated;

grant select, insert, update, delete
on table public.grandtour_tip_selections
to authenticated;

grant select, insert, update, delete
on table
  public.grandtour_stage_scores,
  public.grandtour_leaderboard_snapshots
to authenticated;

grant select on table public.grandtour_game_audit to authenticated;

revoke all privileges on table public.profiles from authenticated;
grant select (id, display_name, avatar_url, is_dummy)
on table public.profiles to authenticated;
grant update (display_name, avatar_url)
on table public.profiles to authenticated;

grant select on table public.grandtour_league_profiles to authenticated;
grant select on table public.grandtour_prize_eligible_scores to authenticated;

revoke all on function public.save_grandtour_tip_draft(
  uuid,
  uuid,
  public.grandtour_tip_mode,
  public.grandtour_tip_scope,
  jsonb,
  text
) from public, anon;
revoke all on function public.submit_grandtour_tip(uuid, text) from public, anon;
revoke all on function public.clear_grandtour_tip_draft(uuid, text, text) from public, anon;
revoke all on function public.lock_grandtour_stage_tips(uuid, text, text) from public, anon;
revoke all on function public.score_grandtour_stage(uuid, text) from public, anon;
revoke all on function public.recalculate_grandtour_stage_scores(uuid, text, text)
from public, anon;

grant execute on function public.save_grandtour_tip_draft(
  uuid,
  uuid,
  public.grandtour_tip_mode,
  public.grandtour_tip_scope,
  jsonb,
  text
) to authenticated;
grant execute on function public.submit_grandtour_tip(uuid, text) to authenticated;
grant execute on function public.clear_grandtour_tip_draft(uuid, text, text)
to authenticated;
grant execute on function public.lock_grandtour_stage_tips(uuid, text, text)
to authenticated;
grant execute on function public.score_grandtour_stage(uuid, text) to authenticated;
grant execute on function public.recalculate_grandtour_stage_scores(uuid, text, text)
to authenticated;

grant all privileges on table
  public.grandtour_game_audit
to postgres;

grant select on table public.grandtour_game_audit to service_role;

-- RPCs need schema usage to invoke the narrowly granted helpers. Revoke every
-- other private function first so this does not expose trigger internals.
revoke execute on all functions in schema grandtour_private
from public, anon, authenticated;
grant usage on schema grandtour_private to authenticated;
grant execute on function grandtour_private.is_cycling_admin() to authenticated;
grant execute on function grandtour_private.can_access_competition(uuid) to authenticated;
grant execute on function grandtour_private.tip_lock_at(
  uuid, uuid, public.grandtour_tip_mode, public.grandtour_tip_scope
) to authenticated;
grant execute on function grandtour_private.tip_is_locked(
  uuid, uuid, public.grandtour_tip_mode, public.grandtour_tip_scope
) to authenticated;
grant execute on function grandtour_private.is_final_stage(uuid) to authenticated;
grant execute on function grandtour_private.tip_is_complete(uuid) to authenticated;
