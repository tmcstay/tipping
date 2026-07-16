-- Replaces "wait up to 15 minutes for the next cron tick" with an immediate,
-- stage-scoped dispatch fired directly from the scoring RPC itself - the
-- actual "scoring completed" event, rather than polling for it.
--
-- Also fixes the "rescoring stage 2 emailed every other already-notified
-- stage" bug: the cron's own invocation body (`{mode: "process_ready_stages"}`)
-- sweeps every finalised+scored stage with no scoping, which is correct for
-- its own backlog-catch-up role but wrong to reuse for a single stage's
-- rescore. This migration adds a second, stage-scoped call path
-- (`{stage_id: ...}`) invoked only for the one stage that was just scored.
-- The 15-minute cron from 20260715060000 is kept, unchanged, as a fallback
-- safety net (crashed invocation, transient net.http_post failure, a
-- correction path that doesn't go through recalculate_grandtour_stage_scores)
-- - not the primary path any more.
--
-- Also fixes the "a rescore never re-notifies" bug: send-stage-results'
-- job-generation upsert is `ON CONFLICT (user_id, stage_id, notification_type)
-- DO NOTHING`, so a user who already has a terminal (sent/failed) job for a
-- stage would never get a new one once that stage's score changes. This
-- migration resets exactly that one stage's terminal jobs back to `pending`
-- before dispatching - never touching any other stage's jobs.

-- A per-job generation counter, bumped every time a job is reset for a
-- rescore. Folded into the Resend Idempotency-Key so a corrected email is
-- never silently deduped against the original send by Resend's own
-- idempotency-key cache.
alter table public.grandtour_stage_notification_jobs
  add column notification_generation integer not null default 1;

comment on column public.grandtour_stage_notification_jobs.notification_generation is
  'Bumped each time this job is reset for a rescore/correction, so the Resend Idempotency-Key changes and the corrected email is not deduped against a prior send.';

-- security definer (unlike recalculate_grandtour_stage_scores itself, which
-- is security invoker and runs as the calling admin) so this always has the
-- privileges to write grandtour_stage_notification_jobs (RLS/grants there
-- are service-role/admin-read-only - see 20260715040000) and to read the
-- Vault secrets + call net.http_post (same pattern the existing cron job
-- already relies on), regardless of which admin session triggered scoring.
create or replace function grandtour_private.dispatch_stage_score_notifications(p_stage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  scheduler_secret text;
begin
  select decrypted_secret into function_url
  from vault.decrypted_secrets where name = 'grandtour_notification_function_url';
  select decrypted_secret into scheduler_secret
  from vault.decrypted_secrets where name = 'grandtour_notification_scheduler_secret';

  -- Defensive only - both secrets are always seeded (locally as safe
  -- placeholders, in production via the real repointing step). Never raise
  -- here: a missing secret must not fail the scoring transaction itself.
  if function_url is null or scheduler_secret is null then
    return;
  end if;

  -- Reset only THIS stage's terminal jobs, so a rescore re-notifies without
  -- ever touching any other stage's already-sent jobs (the bug that made a
  -- stage-2 rescore appear to "resend" stages 3-10).
  update public.grandtour_stage_notification_jobs
  set status = 'pending',
      attempt_count = 0,
      next_attempt_at = now(),
      processing_started_at = null,
      sent_at = null,
      provider_message_id = null,
      last_error_code = null,
      notification_generation = notification_generation + 1,
      idempotency_key = 'stage-result:' || stage_id || ':' || user_id || ':g' || (notification_generation + 1)
  where stage_id = p_stage_id
    and status in ('sent', 'failed');

  perform net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || scheduler_secret
    ),
    -- Always scoped to this one stage - never the bare
    -- {mode: "process_ready_stages"} sweep-everything shape the cron uses.
    body := jsonb_build_object('stage_id', p_stage_id)
  );
end;
$$;

-- recalculate_grandtour_stage_scores is `security invoker` (runs as the
-- calling admin, not this function's owner), so the admin's own role needs
-- direct EXECUTE here - `security definer` only elevates privileges *inside*
-- this function's own body, it does not grant the caller anything. Revoking
-- the default PUBLIC grant and re-granting to `authenticated` only (never
-- `anon`) matches the same gotcha already documented in CLAUDE.md for
-- `is_current_user_cycling_admin` - a fresh `create function` always grants
-- EXECUTE to PUBLIC unless explicitly revoked.
revoke all on function grandtour_private.dispatch_stage_score_notifications(uuid) from public;
grant execute on function grandtour_private.dispatch_stage_score_notifications(uuid) to authenticated, service_role;

-- Fired directly from the "scoring completed" workflow itself, immediately
-- after a stage's tips are (re)scored - never a 15-minute poll wait.
-- recalculate_grandtour_stage_scores is unchanged in signature (same OID,
-- safe create-or-replace) and still security invoker / admin-gated; this
-- addition only appends one call at the very end, after affected_count is
-- known, and skips the dispatch entirely if nothing was actually (re)scored.
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
          'overall_yellow_winner', 'overall_green_winner', 'overall_kom_winner', 'overall_white_winner'
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

  -- Fire the stage-results notification pipeline immediately, scoped to
  -- exactly this stage - the actual "scoring completed" event, instead of
  -- the 15-minute cron poll picking it up eventually. Skipped when nothing
  -- was actually (re)scored (e.g. no eligible tips at all).
  if affected_count > 0 then
    perform grandtour_private.dispatch_stage_score_notifications(p_stage_id);
  end if;

  return affected_count;
end;
$$;
