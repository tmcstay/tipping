-- Additive Team Time Trial support. Rider result tables and existing rider
-- selections are retained for normal stages and historical compatibility.

create type public.grandtour_ttt_timing_rule as enum (
  'team_time',
  'individual_time'
);

alter table public.grandtour_stages
  add column ttt_timing_rule public.grandtour_ttt_timing_rule;

comment on column public.grandtour_stages.ttt_timing_rule is
  'Official TTT timing method. Jersey holders remain official individual riders regardless of this value.';

-- The 2026 opening TTT uses individual timing for the individual GC. Match
-- semantically rather than relying on an environment-specific generated UUID.
update public.grandtour_stages stage
set ttt_timing_rule = 'individual_time'
from public.grand_tours tour
where tour.id = stage.grand_tour_id
  and (
    tour.name = 'Tour de France'
    or stage.source_url ilike '%letour.fr%'
  )
  and tour.year = 2026
  and stage.stage_number = 1
  and stage.stage_type::text in ('team_time_trial', 'ttt')
  and stage.ttt_timing_rule is null;

-- NOT VALID preserves any older TTT row whose historical timing rule is not
-- known. PostgreSQL still enforces the constraint for new and updated rows.
alter table public.grandtour_stages
  add constraint grandtour_stages_ttt_timing_rule_check check (
    (
      stage_type::text in ('team_time_trial', 'ttt')
      and ttt_timing_rule is not null
    )
    or
    (
      stage_type::text not in ('team_time_trial', 'ttt')
      and ttt_timing_rule is null
    )
  ) not valid;

create table public.grandtour_stage_team_result_lines (
  id uuid primary key default gen_random_uuid(),
  stage_result_id uuid not null
    references public.grandtour_stage_results(id) on delete cascade,
  team_id uuid not null
    references public.grandtour_teams(id) on delete restrict,
  actual_position integer not null check (actual_position between 1 and 10),
  created_at timestamptz not null default now(),
  unique (stage_result_id, actual_position),
  unique (stage_result_id, team_id)
);

comment on table public.grandtour_stage_team_result_lines is
  'Official ranked team result lines for TTT stages. Individual jersey holders remain in grandtour_stage_jersey_holders.';

create index grandtour_stage_team_result_lines_team_id_idx
on public.grandtour_stage_team_result_lines (team_id);

alter table public.grandtour_stage_team_result_lines enable row level security;

create policy "Public can read final GrandTour team result lines"
on public.grandtour_stage_team_result_lines for select
to anon, authenticated
using (
  exists (
    select 1
    from public.grandtour_stage_results result
    where result.id = grandtour_stage_team_result_lines.stage_result_id
      and result.is_final
  )
);

create policy "Cycling admins can manage GrandTour team result lines"
on public.grandtour_stage_team_result_lines for all
to authenticated
using ((select grandtour_private.is_cycling_admin()))
with check ((select grandtour_private.is_cycling_admin()));

revoke all privileges on table public.grandtour_stage_team_result_lines
from public, anon, authenticated;
grant select on table public.grandtour_stage_team_result_lines
to anon, authenticated;
grant insert, update, delete on table public.grandtour_stage_team_result_lines
to authenticated;
grant all privileges on table public.grandtour_stage_team_result_lines
to service_role;

alter table public.grandtour_tip_selections
  alter column rider_id drop not null,
  add column team_id uuid
    references public.grandtour_teams(id) on delete restrict;

comment on column public.grandtour_tip_selections.team_id is
  'Team target for stage_top_5 on TTT stages only. Jerseys always target rider_id.';

alter table public.grandtour_tip_selections
  add constraint grandtour_tip_selections_target_check check (
    (
      selection_type = 'stage_top_5'
      and num_nonnulls(rider_id, team_id) = 1
    )
    or
    (
      selection_type <> 'stage_top_5'
      and rider_id is not null
      and team_id is null
    )
  ) not valid;

alter table public.grandtour_tip_selections
  validate constraint grandtour_tip_selections_target_check;

create index grandtour_tip_selections_team_id_idx
on public.grandtour_tip_selections (team_id)
where team_id is not null;

create unique index grandtour_tip_selections_top5_team_uidx
on public.grandtour_tip_selections (tip_id, team_id)
where selection_type = 'stage_top_5' and team_id is not null;

drop trigger grandtour_tip_selections_validate
on public.grandtour_tip_selections;

create trigger grandtour_tip_selections_validate
before insert or update of tip_id, selection_type, rider_id, team_id, predicted_position
on public.grandtour_tip_selections
for each row execute function grandtour_private.validate_tip_selection();

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

    select count(*) into jersey_count
    from public.grandtour_tip_selections selection
    where selection.tip_id = target_tip_id
      and selection.rider_id is not null
      and selection.team_id is null
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

create or replace function grandtour_private.validate_tip_selection()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_stage_id uuid;
  selected_tour_id uuid;
  selected_stage_type text;
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
    stage.stage_type::text,
    tip.tip_scope,
    tip.tip_mode,
    tip.competition_id,
    competition.active_jersey_types
  into
    selected_stage_id,
    selected_tour_id,
    selected_stage_type,
    selected_scope,
    selected_mode,
    selected_competition_id,
    active_jerseys
  from public.grandtour_tips tip
  join public.grandtour_competitions competition
    on competition.id = tip.competition_id
  left join public.grandtour_stages stage on stage.id = tip.stage_id
  where tip.id = new.tip_id;

  if selected_scope is null then
    raise exception 'Selection requires a valid GrandTour tip.';
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

  if selected_scope = 'stage' and new.selection_type = 'stage_top_5' then
    if selected_stage_type in ('team_time_trial', 'ttt') then
      if new.team_id is null or new.rider_id is not null then
        raise exception 'TTT stage Top 5 selections must target teams.';
      end if;

      if not exists (
        select 1
        from public.grandtour_teams team
        where team.id = new.team_id
          and team.grand_tour_id = selected_tour_id
      ) then
        raise exception 'Selected team must belong to the tip tour.';
      end if;

      if not admin_override and not exists (
        select 1
        from public.grandtour_stage_startlists startlist
        where startlist.stage_id = selected_stage_id
          and startlist.team_id = new.team_id
          and startlist.status in ('provisional', 'confirmed')
      ) then
        raise exception 'Selected team must be represented on the stage startlist.';
      end if;
    else
      if new.rider_id is null or new.team_id is not null then
        raise exception 'Non-TTT stage Top 5 selections must target riders.';
      end if;

      if not exists (
        select 1
        from public.grandtour_riders rider
        where rider.id = new.rider_id
          and rider.grand_tour_id = selected_tour_id
          and rider.is_active
      ) then
        raise exception 'Selected rider must be active and belong to the tip tour.';
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
    end if;

    return new;
  end if;

  if new.rider_id is null or new.team_id is not null then
    raise exception 'Jersey selections must target riders.';
  end if;

  if not exists (
    select 1
    from public.grandtour_riders rider
    where rider.id = new.rider_id
      and rider.grand_tour_id = selected_tour_id
      and rider.is_active
  ) then
    raise exception 'Selected rider must be active and belong to the tip tour.';
  end if;

  if selected_scope = 'stage' then
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
  target_status public.grandtour_tip_status;
  selection_record record;
  allowed_selection boolean;
begin
  if target_user_id is null then raise exception 'Authentication is required.'; end if;
  if not grandtour_private.can_access_competition(p_competition_id) then
    raise exception 'Competition membership is required.';
  end if;
  if grandtour_private.tip_is_locked(p_competition_id, p_stage_id, p_tip_mode, p_tip_scope) then
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

  select tip.id, tip.status into target_tip_id, target_status
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
      id, user_id, competition_id, stage_id, tip_mode, tip_scope, status
    ) values (
      target_tip_id, target_user_id, p_competition_id, p_stage_id,
      p_tip_mode, p_tip_scope, 'draft'
    );
  else
    if target_status not in ('draft', 'submitted', 'missed', 'deleted') then
      raise exception 'This tip can no longer be edited.';
    end if;
    update public.grandtour_tips set status = 'draft' where id = target_tip_id;
  end if;

  delete from public.grandtour_tip_selections where tip_id = target_tip_id;

  for selection_record in
    select * from jsonb_to_recordset(p_selections) as selection_payload(
      selection_type text,
      rider_id uuid,
      team_id uuid,
      predicted_position integer
    )
  loop
    allowed_selection := case
      when p_tip_scope = 'stage' then selection_record.selection_type in (
        'stage_top_5', 'yellow_holder', 'green_holder', 'kom_holder', 'white_holder'
      )
      else selection_record.selection_type in (
        'overall_yellow_winner', 'overall_green_winner',
        'overall_kom_winner', 'overall_white_winner'
      )
    end;

    if not allowed_selection or selection_record.selection_type is null then
      raise exception 'Draft contains an invalid selection.';
    end if;

    if selection_record.selection_type = 'stage_top_5' then
      if num_nonnulls(selection_record.rider_id, selection_record.team_id) <> 1 then
        raise exception 'Stage Top 5 selections require exactly one rider or team target.';
      end if;
    elsif selection_record.rider_id is null or selection_record.team_id is not null then
      raise exception 'Jersey selections must target riders.';
    end if;

    insert into public.grandtour_tip_selections (
      tip_id, selection_type, rider_id, team_id, predicted_position
    ) values (
      target_tip_id,
      selection_record.selection_type::public.grandtour_tip_selection_type,
      selection_record.rider_id,
      selection_record.team_id,
      selection_record.predicted_position
    );
  end loop;

  perform set_config('grandtour.suppress_audit', 'off', true);
  update public.grandtour_tips set updated_at = now() where id = target_tip_id;
  return target_tip_id;
end;
$$;

create or replace function grandtour_private.validate_team_result_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_stage_id uuid;
  selected_tour_id uuid;
  selected_stage_type text;
  result_is_final boolean;
begin
  select
    result.stage_id,
    stage.grand_tour_id,
    stage.stage_type::text,
    result.is_final
  into selected_stage_id, selected_tour_id, selected_stage_type, result_is_final
  from public.grandtour_stage_results result
  join public.grandtour_stages stage on stage.id = result.stage_id
  where result.id = new.stage_result_id;

  if selected_stage_id is null then
    raise exception 'Team result line requires a valid stage result.';
  end if;
  if selected_stage_type not in ('team_time_trial', 'ttt') then
    raise exception 'Team result lines are only valid for TTT stages.';
  end if;
  if result_is_final then
    raise exception 'Final stage results must be reopened before editing team result lines.';
  end if;
  if not exists (
    select 1
    from public.grandtour_teams team
    where team.id = new.team_id
      and team.grand_tour_id = selected_tour_id
  ) then
    raise exception 'Result team must belong to the result tour.';
  end if;
  if not exists (
    select 1
    from public.grandtour_stage_startlists startlist
    where startlist.stage_id = selected_stage_id
      and startlist.team_id = new.team_id
      and startlist.status in ('provisional', 'confirmed', 'dnf')
  ) then
    raise exception 'Result team must be represented on the stage startlist.';
  end if;

  return new;
end;
$$;

create or replace function grandtour_private.prevent_final_team_result_line_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.grandtour_stage_results result
    where result.id = old.stage_result_id
      and result.is_final
  ) then
    raise exception 'Final stage results must be reopened before deleting team result lines.';
  end if;

  return old;
end;
$$;

create or replace function grandtour_private.validate_final_result()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_stage_type text;
  rider_result_line_count integer;
  team_result_line_count integer;
begin
  if new.is_final and (tg_op = 'INSERT' or old.is_final is distinct from new.is_final) then
    select stage.stage_type::text into selected_stage_type
    from public.grandtour_stages stage
    where stage.id = new.stage_id;

    select count(*) into rider_result_line_count
    from public.grandtour_stage_result_lines line
    where line.stage_result_id = new.id;

    select count(*) into team_result_line_count
    from public.grandtour_stage_team_result_lines line
    where line.stage_result_id = new.id;

    if selected_stage_type in ('team_time_trial', 'ttt') then
      if team_result_line_count not in (5, 10) then
        raise exception 'A final TTT result requires five or ten team result lines.';
      end if;
      if rider_result_line_count <> 0 then
        raise exception 'A final TTT result cannot contain rider stage placings.';
      end if;
    else
      if rider_result_line_count not in (5, 10) then
        raise exception 'A final non-TTT result requires five or ten rider result lines.';
      end if;
      if team_result_line_count <> 0 then
        raise exception 'A final non-TTT result cannot contain team stage placings.';
      end if;
    end if;

    if (
      select count(*)
      from public.grandtour_stage_jersey_holders holder
      where holder.stage_id = new.stage_id
    ) <> 4 then
      raise exception 'A final stage result requires all four individual jersey holders.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger grandtour_stage_team_result_lines_validate
before insert or update
on public.grandtour_stage_team_result_lines
for each row execute function grandtour_private.validate_team_result_line();

create trigger grandtour_stage_team_result_lines_prevent_final_delete
before delete
on public.grandtour_stage_team_result_lines
for each row execute function grandtour_private.prevent_final_team_result_line_delete();

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
  elsif tg_table_name in (
    'grandtour_stage_result_lines',
    'grandtour_stage_team_result_lines'
  ) then
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

create trigger grandtour_stage_team_result_lines_audit
after insert or update or delete
on public.grandtour_stage_team_result_lines
for each row execute function grandtour_private.audit_result_mutation();

revoke all on function grandtour_private.validate_team_result_line()
from public, anon, authenticated;
revoke all on function grandtour_private.prevent_final_team_result_line_delete()
from public, anon, authenticated;

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
  stage_type_text text;
  stage_timing_rule text;
  stage_is_ttt boolean;
  top_five_points integer;
  jersey_points integer;
  total_points integer;
  top_five_breakdown jsonb;
  jersey_breakdown jsonb;
  score_breakdown jsonb;
  affected_count integer := 0;
  score_action text;
  eligible boolean;
  final_stage boolean;
begin
  if not grandtour_private.is_cycling_admin() then
    raise exception 'GrandTour administrator access is required.';
  end if;
  if not exists (
    select 1 from public.grandtour_stage_results result
    where result.stage_id = p_stage_id and result.is_final
  ) then raise exception 'Scoring requires a final stage result.'; end if;

  select stage.stage_type::text, stage.ttt_timing_rule::text
  into stage_type_text, stage_timing_rule
  from public.grandtour_stages stage
  where stage.id = p_stage_id;

  if stage_type_text is null then
    raise exception 'Scoring requires a valid GrandTour stage.';
  end if;

  stage_is_ttt := stage_type_text in ('team_time_trial', 'ttt');
  score_action := case when exists (
    select 1 from public.grandtour_stage_scores score where score.stage_id = p_stage_id
  ) then 'score_recalculated' else 'score_calculated' end;
  final_stage := grandtour_private.is_final_stage(p_stage_id);

  perform set_config('grandtour.request_id', coalesce(p_request_id, ''), true);
  perform set_config('grandtour.audit_reason', coalesce(p_reason, ''), true);
  perform set_config('grandtour.audit_action', score_action, true);
  perform set_config('grandtour.admin_override', 'on', true);

  for tip_record in
    select tip.*
    from public.grandtour_tips tip
    join public.grandtour_competitions competition on competition.id = tip.competition_id
    join public.grandtour_stages stage
      on stage.id = p_stage_id and stage.grand_tour_id = competition.grand_tour_id
    where (tip.tip_scope = 'stage' and tip.stage_id = p_stage_id)
       or (final_stage and tip.tip_scope = 'overall_jerseys' and tip.stage_id is null)
    order by tip.id
    for update of tip
  loop
    eligible := tip_record.status in ('submitted', 'locked', 'scored', 'corrected');
    top_five_points := 0;
    jersey_points := 0;
    top_five_breakdown := '[]'::jsonb;
    jersey_breakdown := '[]'::jsonb;

    if eligible and tip_record.tip_scope = 'stage' then
      if stage_is_ttt then
        select
          coalesce(sum(case
            when result_line.team_id is null then 0
            when result_line.actual_position = selection.predicted_position then
              case selection.predicted_position
                when 1 then 10 when 2 then 8 when 3 then 6
                when 4 then 4 when 5 then 2 else 0
              end
            else 1
          end), 0),
          coalesce(jsonb_agg(jsonb_build_object(
            'target_type', 'team',
            'predicted_position', selection.predicted_position,
            'team_id', selection.team_id,
            'actual_position', result_line.actual_position,
            'points', case
              when result_line.team_id is null then 0
              when result_line.actual_position = selection.predicted_position then
                case selection.predicted_position
                  when 1 then 10 when 2 then 8 when 3 then 6
                  when 4 then 4 when 5 then 2 else 0
                end
              else 1
            end
          ) order by selection.predicted_position), '[]'::jsonb)
        into top_five_points, top_five_breakdown
        from public.grandtour_tip_selections selection
        left join public.grandtour_stage_results result
          on result.stage_id = p_stage_id and result.is_final
        left join public.grandtour_stage_team_result_lines result_line
          on result_line.stage_result_id = result.id
         and result_line.team_id = selection.team_id
         and result_line.actual_position between 1 and 5
        where selection.tip_id = tip_record.id
          and selection.selection_type = 'stage_top_5';
      else
        select
          coalesce(sum(case
            when result_line.rider_id is null then 0
            when result_line.actual_position = selection.predicted_position then
              case selection.predicted_position
                when 1 then 10 when 2 then 8 when 3 then 6
                when 4 then 4 when 5 then 2 else 0
              end
            else 1
          end), 0),
          coalesce(jsonb_agg(jsonb_build_object(
            'target_type', 'rider',
            'predicted_position', selection.predicted_position,
            'rider_id', selection.rider_id,
            'actual_position', result_line.actual_position,
            'points', case
              when result_line.rider_id is null then 0
              when result_line.actual_position = selection.predicted_position then
                case selection.predicted_position
                  when 1 then 10 when 2 then 8 when 3 then 6
                  when 4 then 4 when 5 then 2 else 0
                end
              else 1
            end
          ) order by selection.predicted_position), '[]'::jsonb)
        into top_five_points, top_five_breakdown
        from public.grandtour_tip_selections selection
        left join public.grandtour_stage_results result
          on result.stage_id = p_stage_id and result.is_final
        left join public.grandtour_stage_result_lines result_line
          on result_line.stage_result_id = result.id
         and result_line.rider_id = selection.rider_id
         and result_line.actual_position between 1 and 5
        where selection.tip_id = tip_record.id
          and selection.selection_type = 'stage_top_5';
      end if;

      -- TTT team placings never determine an individual jersey holder.
      select
        coalesce(sum(case when holder.rider_id = selection.rider_id then 5 else 0 end), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'selection_type', selection.selection_type,
          'predicted_rider_id', selection.rider_id,
          'actual_rider_id', holder.rider_id,
          'points', case when holder.rider_id = selection.rider_id then 5 else 0 end
        ) order by selection.selection_type), '[]'::jsonb)
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
        and selection.selection_type = any (array[
          'yellow_holder', 'green_holder', 'kom_holder', 'white_holder'
        ]::public.grandtour_tip_selection_type[]);
    elsif eligible and tip_record.tip_scope = 'overall_jerseys' and final_stage then
      select
        coalesce(sum(case when holder.rider_id = selection.rider_id then 25 else 0 end), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'selection_type', selection.selection_type,
          'predicted_rider_id', selection.rider_id,
          'actual_rider_id', holder.rider_id,
          'points', case when holder.rider_id = selection.rider_id then 25 else 0 end
        ) order by selection.selection_type), '[]'::jsonb)
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
        and selection.selection_type = any (array[
          'overall_yellow_winner', 'overall_green_winner',
          'overall_kom_winner', 'overall_white_winner'
        ]::public.grandtour_tip_selection_type[]);
    end if;

    total_points := case when eligible then top_five_points + jersey_points else 0 end;
    score_breakdown := jsonb_build_object(
      'tip_scope', tip_record.tip_scope,
      'tip_status', tip_record.status,
      'stage_type', stage_type_text,
      'ttt_timing_rule', stage_timing_rule,
      'eligible_status', eligible,
      'top_five', top_five_breakdown,
      'top_five_score', top_five_points,
      'jerseys', jersey_breakdown,
      'jersey_score', jersey_points,
      'total_score', total_points
    );

    insert into public.grandtour_stage_scores (
      tip_id, user_id, competition_id, stage_id, tip_mode, tip_scope,
      top5_score, jersey_score, bonus_score, total_score, score_details
    ) values (
      tip_record.id, tip_record.user_id, tip_record.competition_id, p_stage_id,
      tip_record.tip_mode, tip_record.tip_scope, top_five_points,
      jersey_points, 0, total_points, score_breakdown
    )
    on conflict (tip_id) do update set
      stage_id = excluded.stage_id,
      top5_score = excluded.top5_score,
      jersey_score = excluded.jersey_score,
      bonus_score = excluded.bonus_score,
      total_score = excluded.total_score,
      score_details = excluded.score_details,
      scored_at = now();

    update public.grandtour_tips set
      total_score = total_points,
      status = case
        when tip_record.status = 'corrected' then 'corrected'::public.grandtour_tip_status
        when eligible then 'scored'::public.grandtour_tip_status
        else tip_record.status
      end
    where id = tip_record.id;
    affected_count := affected_count + 1;
  end loop;
  return affected_count;
end;
$$;
