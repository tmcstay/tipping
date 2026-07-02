-- Additive lifecycle hardening for the canonical GrandTour workflow.
-- Existing tips and selections are preserved. User clearing is a soft delete.

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
    new.locked_at := null;
    new.total_score := 0;
  elsif new.status = 'draft' then
    new.submitted_at := null;
    new.locked_at := null;
    new.total_score := 0;
  elsif new.status = 'locked' then
    new.locked_at := coalesce(new.locked_at, now());
  elsif new.status = 'deleted' then
    if tg_op = 'UPDATE'
      and old.status is distinct from new.status
      and grandtour_private.tip_is_locked(
        new.competition_id, new.stage_id, new.tip_mode, new.tip_scope
      )
      and not (
        coalesce(current_setting('grandtour.admin_override', true), '') = 'on'
        and grandtour_private.is_cycling_admin()
      ) then
      raise exception 'Tip clearing is locked.';
    end if;
    new.total_score := 0;
    new.submitted_at := null;
    new.locked_at := null;
  elsif new.status in ('missed', 'voided') then
    new.total_score := 0;
    if new.status = 'missed' then
      new.submitted_at := null;
      new.locked_at := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

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
    if tg_op = 'DELETE' or new.status = 'deleted' then
      audit_action := 'tip_cleared';
    elsif new.status = 'submitted'
      and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      audit_action := 'tip_submitted';
    elsif new.status = 'locked'
      and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      audit_action := 'tip_locked';
    elsif new.status = 'voided' then
      audit_action := 'tip_voided';
    elsif new.status = 'corrected' then
      audit_action := 'tip_corrected';
    elsif new.status = 'scored' then
      audit_action := 'score_calculated';
    elsif new.status = 'draft' then
      audit_action := 'draft_saved';
    else
      audit_action := 'admin_override';
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
    actor_user_id, action, entity_type, entity_id, competition_id,
    stage_id, tip_id, old_value, new_value, reason, request_id
  ) values (
    (select auth.uid()), audit_action, 'tip', target_tip.id,
    target_tip.competition_id, target_tip.stage_id, target_tip.id,
    old_payload, new_payload, audit_reason, audit_request
  );
  return coalesce(new, old);
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
      selection_type text, rider_id uuid, predicted_position int
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
    if not allowed_selection or selection_record.selection_type is null
      or selection_record.rider_id is null then
      raise exception 'Draft contains an invalid selection.';
    end if;
    insert into public.grandtour_tip_selections (
      tip_id, selection_type, rider_id, predicted_position
    ) values (
      target_tip_id,
      selection_record.selection_type::public.grandtour_tip_selection_type,
      selection_record.rider_id,
      selection_record.predicted_position
    );
  end loop;

  perform set_config('grandtour.suppress_audit', 'off', true);
  update public.grandtour_tips set updated_at = now() where id = target_tip_id;
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
  select * into target_tip from public.grandtour_tips
  where id = p_tip_id and user_id = (select auth.uid());
  if target_tip.id is null then raise exception 'Tip was not found.'; end if;
  if target_tip.status not in ('draft', 'submitted') then
    raise exception 'Only a draft can be submitted.';
  end if;
  if not grandtour_private.can_access_competition(target_tip.competition_id) then
    raise exception 'Competition membership is required.';
  end if;
  if grandtour_private.tip_is_locked(
    target_tip.competition_id, target_tip.stage_id,
    target_tip.tip_mode, target_tip.tip_scope
  ) then raise exception 'Tip submission is locked.'; end if;
  if not grandtour_private.tip_is_complete(target_tip.id) then
    raise exception 'Tip is incomplete.';
  end if;
  perform set_config('grandtour.request_id', coalesce(p_request_id, ''), true);
  perform set_config('grandtour.audit_action', 'tip_submitted', true);
  update public.grandtour_tips set status = 'submitted'
  where id = target_tip.id returning * into target_tip;
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
  select * into target_tip from public.grandtour_tips
  where id = p_tip_id and user_id = (select auth.uid());
  if target_tip.id is null then return false; end if;
  if target_tip.status not in ('draft', 'submitted') then
    raise exception 'Only an editable tip can be cleared.';
  end if;
  if grandtour_private.tip_is_locked(
    target_tip.competition_id, target_tip.stage_id,
    target_tip.tip_mode, target_tip.tip_scope
  ) then raise exception 'Tip clearing is locked.'; end if;

  perform set_config('grandtour.request_id', coalesce(p_request_id, ''), true);
  perform set_config('grandtour.audit_reason', coalesce(p_reason, ''), true);
  perform set_config('grandtour.audit_action', 'tip_cleared', true);
  perform set_config('grandtour.clearing_tip', 'on', true);

  update public.grandtour_tips
  set status = 'deleted', submitted_at = null, locked_at = null, total_score = 0
  where id = target_tip.id;
  delete from public.grandtour_tip_selections where tip_id = target_tip.id;
  return true;
end;
$$;

drop policy if exists "Users can read own or post-lock eligible GrandTour tips"
on public.grandtour_tips;
create policy "Users can read own or post-lock eligible GrandTour tips"
on public.grandtour_tips for select to authenticated
using (
  user_id = (select auth.uid())
  or grandtour_private.is_cycling_admin()
  or (
    status in ('submitted', 'locked', 'scored', 'corrected')
    and grandtour_private.tip_is_locked(competition_id, stage_id, tip_mode, tip_scope)
    and grandtour_private.can_access_competition(competition_id)
  )
);

drop policy if exists "Users can update own unlocked GrandTour tips"
on public.grandtour_tips;
create policy "Users can update own unlocked GrandTour tips"
on public.grandtour_tips for update to authenticated
using (
  grandtour_private.is_cycling_admin()
  or (
    user_id = (select auth.uid())
    and status in ('draft', 'submitted', 'missed', 'deleted')
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
    and status in ('draft', 'submitted', 'deleted')
    and locked_at is null
    and total_score = 0
    and grandtour_private.can_access_competition(competition_id)
    and not grandtour_private.tip_is_locked(
      competition_id, stage_id, tip_mode, tip_scope
    )
  )
);

drop policy if exists "Users can read visible GrandTour selections"
on public.grandtour_tip_selections;
create policy "Users can read visible GrandTour selections"
on public.grandtour_tip_selections for select to authenticated
using (
  exists (
    select 1 from public.grandtour_tips tip
    where tip.id = grandtour_tip_selections.tip_id
      and (
        tip.user_id = (select auth.uid())
        or grandtour_private.is_cycling_admin()
        or (
          tip.status in ('submitted', 'locked', 'scored', 'corrected')
          and grandtour_private.tip_is_locked(
            tip.competition_id, tip.stage_id, tip.tip_mode, tip.tip_scope
          )
          and grandtour_private.can_access_competition(tip.competition_id)
        )
      )
  )
);

drop policy if exists "Users can delete own unlocked draft selections"
on public.grandtour_tip_selections;
create policy "Users can delete own unlocked draft selections"
on public.grandtour_tip_selections for delete to authenticated
using (
  exists (
    select 1 from public.grandtour_tips tip
    where tip.id = grandtour_tip_selections.tip_id
      and tip.user_id = (select auth.uid())
      and tip.status in ('draft', 'deleted')
      and grandtour_private.can_access_competition(tip.competition_id)
      and not grandtour_private.tip_is_locked(
        tip.competition_id, tip.stage_id, tip.tip_mode, tip.tip_scope
      )
  )
);

-- Hard deletion is not part of the public gameplay API. The clear RPC retains
-- the tip and audit identity while removing its editable selections.
drop policy if exists "Users can delete own unlocked GrandTour tips"
on public.grandtour_tips;
revoke delete on table public.grandtour_tips from authenticated;

revoke all on function public.save_grandtour_tip_draft(
  uuid, uuid, public.grandtour_tip_mode, public.grandtour_tip_scope, jsonb, text
) from public, anon;
revoke all on function public.submit_grandtour_tip(uuid, text) from public, anon;
revoke all on function public.clear_grandtour_tip_draft(uuid, text, text) from public, anon;
grant execute on function public.save_grandtour_tip_draft(
  uuid, uuid, public.grandtour_tip_mode, public.grandtour_tip_scope, jsonb, text
) to authenticated;
grant execute on function public.submit_grandtour_tip(uuid, text) to authenticated;
grant execute on function public.clear_grandtour_tip_draft(uuid, text, text)
to authenticated;

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
      and tip.status in ('submitted', 'locked', 'scored', 'corrected')
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

  if new.user_id is null then raise exception 'Stage score requires a valid tip.'; end if;
  if not exists (
    select 1 from public.grandtour_stage_results result
    where result.stage_id = new.stage_id and result.is_final
  ) then raise exception 'Stage score requires a final stage result.'; end if;
  new.scored_at := now();
  return new;
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
    select 1 from public.grandtour_stage_results result
    where result.stage_id = p_stage_id and result.is_final
  ) then raise exception 'Scoring requires a final stage result.'; end if;

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
