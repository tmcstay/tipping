-- GrandTour standings are derived live from authoritative, idempotent score
-- rows. Snapshot rows remain available for historical/reporting uses but are
-- not required by the launch UI.
create or replace function public.get_grandtour_leaderboard(
  p_competition_id uuid,
  p_leaderboard_type text default 'overall'
)
returns table (
  id uuid,
  user_id uuid,
  leaderboard_type text,
  rank integer,
  total_score integer,
  stages_tipped integer,
  last_stage_score integer,
  snapshot_at timestamptz,
  is_dummy boolean,
  is_prize_eligible boolean,
  display_name text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  if p_leaderboard_type not in ('daily', 'preselection', 'overall') then
    raise exception 'Invalid GrandTour leaderboard type.';
  end if;

  if not grandtour_private.can_access_competition(p_competition_id) then
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
  order by ranked.leaderboard_rank, profile.display_name, ranked.user_id;
end;
$$;

revoke all on function public.get_grandtour_leaderboard(uuid, text)
from public, anon;
grant execute on function public.get_grandtour_leaderboard(uuid, text)
to authenticated;
