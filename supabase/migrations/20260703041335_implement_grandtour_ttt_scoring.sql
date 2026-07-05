-- Team Time Trial scoring is intentionally isolated from the canonical rider
-- scoring branch. A TTT may publish its official team result before all four
-- official individual jersey holders are available.

alter table public.grandtour_stage_scores
  drop constraint grandtour_stage_scores_canonical_breakdown_check,
  add constraint grandtour_stage_scores_canonical_breakdown_check check (
    top5_score between 0 and 30
    and (
      (
        bonus_score = 0
        and (
          (tip_scope = 'stage' and total_score between 0 and 50)
          or
          (tip_scope = 'overall_jerseys' and total_score between 0 and 100)
        )
      )
      or
      (
        tip_scope = 'stage'
        and score_details ->> 'stage_result_type' = 'team'
        and bonus_score between 0 and 4
        and total_score between 0 and 54
      )
    )
  ) not valid;

-- A perfect TTT is 30 team-position points, four winner-bonus points, and
-- twenty jersey points. Snapshot storage must be able to retain that score.
alter table public.grandtour_leaderboard_snapshots
  drop constraint grandtour_leaderboard_canonical_last_stage_check,
  add constraint grandtour_leaderboard_canonical_last_stage_check check (
    last_stage_score is null or last_stage_score between 0 and 54
  ) not valid;

create or replace function grandtour_private.validate_final_result()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_stage_type text;
  rider_result_line_count integer;
  team_result_line_count integer;
  jersey_holder_count integer;
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

    select count(*) into jersey_holder_count
    from public.grandtour_stage_jersey_holders holder
    where holder.stage_id = new.stage_id;

    if selected_stage_type in ('team_time_trial', 'ttt') then
      if team_result_line_count not in (0, 5, 10) then
        raise exception 'A final TTT team component requires zero, five, or ten team result lines.';
      end if;
      if rider_result_line_count <> 0 then
        raise exception 'A final TTT result cannot contain rider stage placings.';
      end if;
      if team_result_line_count = 0 and jersey_holder_count = 0 then
        raise exception 'A final TTT result requires an official team or jersey component.';
      end if;
    else
      if rider_result_line_count not in (5, 10) then
        raise exception 'A final non-TTT result requires five or ten rider result lines.';
      end if;
      if team_result_line_count <> 0 then
        raise exception 'A final non-TTT result cannot contain team stage placings.';
      end if;
      if jersey_holder_count <> 4 then
        raise exception 'A final stage result requires all four individual jersey holders.';
      end if;
    end if;
  end if;

  new.updated_at := now();
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
  target_stage_result_id uuid;
  stage_type_text text;
  stage_timing_rule text;
  stage_is_ttt boolean;
  team_result_available boolean := false;
  top_five_points integer;
  jersey_points integer;
  winning_team_bonus integer;
  total_points integer;
  top_five_breakdown jsonb;
  jersey_breakdown jsonb;
  score_breakdown jsonb;
  official_yellow_holder_rider_id uuid;
  jersey_pending boolean;
  affected_count integer := 0;
  score_action text;
  eligible boolean;
  final_stage boolean;
begin
  if not grandtour_private.is_cycling_admin() then
    raise exception 'GrandTour administrator access is required.';
  end if;

  select result.id into target_stage_result_id
  from public.grandtour_stage_results result
  where result.stage_id = p_stage_id
    and result.is_final;

  if target_stage_result_id is null then
    raise exception 'Scoring requires a final stage result.';
  end if;

  select stage.stage_type::text, stage.ttt_timing_rule::text
  into stage_type_text, stage_timing_rule
  from public.grandtour_stages stage
  where stage.id = p_stage_id;

  if stage_type_text is null then
    raise exception 'Scoring requires a valid GrandTour stage.';
  end if;

  stage_is_ttt := stage_type_text in ('team_time_trial', 'ttt');
  if stage_is_ttt then
    select count(*) = 5 into team_result_available
    from public.grandtour_stage_team_result_lines result_line
    where result_line.stage_result_id = target_stage_result_id
      and result_line.actual_position between 1 and 5;
  end if;

  select holder.rider_id into official_yellow_holder_rider_id
  from public.grandtour_stage_jersey_holders holder
  where holder.stage_id = p_stage_id
    and holder.jersey_type = 'yellow';

  score_action := case when exists (
    select 1 from public.grandtour_stage_scores score where score.stage_id = p_stage_id
  ) then 'score_recalculated' else 'score_calculated' end;
  final_stage := grandtour_private.is_final_stage(p_stage_id);

  perform set_config('grandtour.request_id', coalesce(p_request_id, ''), true);
  perform set_config('grandtour.audit_reason', coalesce(p_reason, ''), true);
  perform set_config('grandtour.audit_action', score_action, true);
  perform set_config('grandtour.admin_override', 'on', true);

  for tip_record in
    select tip.*, competition.active_jersey_types
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
    winning_team_bonus := 0;
    top_five_breakdown := '[]'::jsonb;
    jersey_breakdown := '[]'::jsonb;
    jersey_pending := false;

    if eligible and tip_record.tip_scope = 'stage' then
      if stage_is_ttt then
        select
          coalesce(sum(case
            when not team_result_available then 0
            when result_line.team_id is null then 0
            when result_line.actual_position = selection.predicted_position then 6
            else 3
          end), 0),
          coalesce(jsonb_agg(jsonb_build_object(
            'target_type', 'team',
            'predicted_position', selection.predicted_position,
            'team_id', selection.team_id,
            'actual_position', result_line.actual_position,
            'points', case
              when not team_result_available then null
              when result_line.team_id is null then 0
              when result_line.actual_position = selection.predicted_position then 6
              else 3
            end
          ) order by selection.predicted_position), '[]'::jsonb)
        into top_five_points, top_five_breakdown
        from public.grandtour_tip_selections selection
        left join public.grandtour_stage_team_result_lines result_line
          on result_line.stage_result_id = target_stage_result_id
         and result_line.team_id = selection.team_id
         and result_line.actual_position between 1 and 5
        where selection.tip_id = tip_record.id
          and selection.selection_type = 'stage_top_5';

        if team_result_available and exists (
          select 1
          from public.grandtour_tip_selections selection
          join public.grandtour_stage_team_result_lines result_line
            on result_line.stage_result_id = target_stage_result_id
           and result_line.team_id = selection.team_id
           and result_line.actual_position = 1
          where selection.tip_id = tip_record.id
            and selection.selection_type = 'stage_top_5'
            and selection.predicted_position = 1
        ) then
          winning_team_bonus := 4;
        end if;
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
        left join public.grandtour_stage_result_lines result_line
          on result_line.stage_result_id = target_stage_result_id
         and result_line.rider_id = selection.rider_id
         and result_line.actual_position between 1 and 5
        where selection.tip_id = tip_record.id
          and selection.selection_type = 'stage_top_5';
      end if;

      if stage_is_ttt then
        select exists (
          select 1
          from unnest(tip_record.active_jersey_types) required(jersey_type)
          where not exists (
            select 1
            from public.grandtour_stage_jersey_holders holder
            where holder.stage_id = p_stage_id
              and holder.jersey_type = required.jersey_type
          )
        ) into jersey_pending;
      end if;

      -- Jersey points always compare the picked rider with the official
      -- individual holder. Team membership and the winning team are irrelevant.
      select
        coalesce(sum(case when holder.rider_id = selection.rider_id then 5 else 0 end), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'selection_type', selection.selection_type,
          'predicted_rider_id', selection.rider_id,
          'actual_rider_id', holder.rider_id,
          'pending', stage_is_ttt and holder.rider_id is null,
          'points', case
            when stage_is_ttt and holder.rider_id is null then null
            when holder.rider_id = selection.rider_id then 5
            else 0
          end
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

    total_points := case
      when eligible then top_five_points + winning_team_bonus + jersey_points
      else 0
    end;
    score_breakdown := jsonb_build_object(
      'tip_scope', tip_record.tip_scope,
      'tip_status', tip_record.status,
      'stage_type', stage_type_text,
      'stage_result_type', case when stage_is_ttt then 'team' else 'rider' end,
      'ttt_timing_rule', stage_timing_rule,
      'eligible_status', eligible,
      'team_result_pending', stage_is_ttt and not team_result_available,
      'top_five', top_five_breakdown,
      'top_five_score', top_five_points,
      'team_stage_score', case
        when stage_is_ttt then top_five_points + winning_team_bonus
        else null
      end,
      'winning_team_bonus', winning_team_bonus,
      'jerseys', jersey_breakdown,
      'jersey_score', jersey_points,
      'jersey_pending', jersey_pending,
      'official_yellow_holder_rider_id', official_yellow_holder_rider_id,
      'total_score', total_points
    );

    insert into public.grandtour_stage_scores (
      tip_id, user_id, competition_id, stage_id, tip_mode, tip_scope,
      top5_score, jersey_score, bonus_score, total_score, score_details
    ) values (
      tip_record.id, tip_record.user_id, tip_record.competition_id, p_stage_id,
      tip_record.tip_mode, tip_record.tip_scope, top_five_points,
      jersey_points, winning_team_bonus, total_points, score_breakdown
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
