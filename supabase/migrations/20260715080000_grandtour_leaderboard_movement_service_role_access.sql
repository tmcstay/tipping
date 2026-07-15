-- Fixes a real bug found while locally dry-running send-stage-results:
-- get_grandtour_leaderboard_with_movement is security invoker and
-- unconditionally required `auth.uid()` to be non-null plus
-- grandtour_private.can_access_competition(p_competition_id) - both of
-- which are meaningless for a service-role caller (no user session, so
-- auth.uid() is null), which is exactly what send-stage-results uses to
-- read each recipient's rank/previous_rank/total_score server-side (see
-- CLAUDE.md's "Resend transactional email" section). Confirmed by a real
-- local call failing with "Authentication is required."
--
-- Fixed the same way mark_grandtour_stage_result_checked/
-- finalize_grandtour_stage_result already allow a service-role caller
-- alongside a real admin session (`auth.role() = 'service_role' or ...`) -
-- not a new pattern, the established one for exactly this trust boundary.
-- Every existing authenticated-caller code path (the app's own leaderboard
-- screen) is completely unaffected - both guards still apply to it
-- unchanged; only a service-role caller gets a new bypass. Same parameter
-- list/signature as the current function, so this is a safe same-OID
-- `create or replace` - no drop/regrant needed.
create or replace function public.get_grandtour_leaderboard_with_movement(p_competition_id uuid, p_leaderboard_type text default 'overall'::text)
returns table(id uuid, user_id uuid, leaderboard_type text, rank integer, previous_rank integer, total_score integer, stages_tipped integer, last_stage_score integer, snapshot_at timestamp with time zone, is_dummy boolean, is_prize_eligible boolean, display_name text)
language plpgsql
stable
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null and auth.role() <> 'service_role' then
    raise exception 'Authentication is required.';
  end if;

  if p_leaderboard_type not in ('daily', 'preselection', 'overall') then
    raise exception 'Invalid GrandTour leaderboard type.';
  end if;

  if auth.role() <> 'service_role' and not grandtour_private.can_access_competition(p_competition_id) then
    raise exception 'GrandTour competition access is required.';
  end if;

  return query
  with eligible_scores as (
    select
      score.user_id,
      score.stage_id,
      score.tip_mode,
      score.tip_scope,
      score.total_score,
      score.scored_at,
      score.is_prize_eligible
    from public.grandtour_stage_scores score
    join public.grandtour_tips tip on tip.id = score.tip_id
    where score.competition_id = p_competition_id
      and tip.status in ('scored', 'corrected')
      and (
        p_leaderboard_type = 'overall'
        or score.tip_mode::text = p_leaderboard_type
      )
  ),
  user_totals as (
    select
      score.user_id,
      sum(score.total_score)::integer as total_score,
      max(score.scored_at) as calculated_at,
      bool_and(score.is_prize_eligible) as scores_prize_eligible
    from eligible_scores score
    group by score.user_id
  ),
  stage_totals as (
    select
      score.user_id,
      score.stage_id,
      stage.stage_number,
      sum(score.total_score)::integer as stage_score
    from eligible_scores score
    join public.grandtour_stages stage on stage.id = score.stage_id
    where score.tip_scope = 'stage'
    group by score.user_id, score.stage_id, stage.stage_number
  ),
  stage_summaries as (
    select
      stage_score.user_id,
      count(*)::integer as stages_tipped
    from stage_totals stage_score
    group by stage_score.user_id
  ),
  latest_stage_scores as (
    select ranked_stage.user_id, ranked_stage.stage_score
    from (
      select
        stage_score.user_id,
        stage_score.stage_score,
        row_number() over (
          partition by stage_score.user_id
          order by stage_score.stage_number desc, stage_score.stage_id desc
        ) as row_number
      from stage_totals stage_score
    ) ranked_stage
    where ranked_stage.row_number = 1
  ),
  latest_overall_stage as (
    select stage_totals.stage_id
    from stage_totals
    order by stage_totals.stage_number desc, stage_totals.stage_id desc
    limit 1
  ),
  previous_totals as (
    select
      user_total.user_id,
      user_total.total_score - coalesce(user_latest.stage_score, 0) as previous_score,
      coalesce(stage_summary.stages_tipped, 0)
        - case when user_latest.stage_id is not null then 1 else 0 end as stages_tipped_before
    from user_totals user_total
    left join stage_summaries stage_summary on stage_summary.user_id = user_total.user_id
    left join stage_totals user_latest
      on user_latest.user_id = user_total.user_id
      and user_latest.stage_id = (select latest_overall_stage.stage_id from latest_overall_stage)
  ),
  ranked_previous as (
    select
      previous_totals.user_id,
      rank() over (order by previous_totals.previous_score desc)::integer as previous_rank
    from previous_totals
    where previous_totals.stages_tipped_before > 0
  ),
  ranked_totals as (
    select
      user_total.*,
      rank() over (order by user_total.total_score desc)::integer as leaderboard_rank
    from user_totals user_total
  )
  select
    ranked.user_id as id,
    ranked.user_id,
    p_leaderboard_type,
    ranked.leaderboard_rank,
    ranked_previous.previous_rank,
    ranked.total_score,
    coalesce(stage_summary.stages_tipped, 0),
    latest_stage.stage_score,
    ranked.calculated_at,
    profile.is_dummy,
    ranked.scores_prize_eligible and not profile.is_dummy,
    coalesce(profile.display_name, 'Entry ' || left(ranked.user_id::text, 8))
  from ranked_totals ranked
  join public.profiles profile on profile.id = ranked.user_id
  left join stage_summaries stage_summary on stage_summary.user_id = ranked.user_id
  left join latest_stage_scores latest_stage on latest_stage.user_id = ranked.user_id
  left join ranked_previous on ranked_previous.user_id = ranked.user_id
  order by ranked.leaderboard_rank, profile.display_name, ranked.user_id;
end;
$function$;

grant execute on function public.get_grandtour_leaderboard_with_movement(uuid, text) to service_role;
