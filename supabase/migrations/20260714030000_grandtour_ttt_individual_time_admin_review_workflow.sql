-- Extends mark_grandtour_stage_result_checked() and
-- finalize_grandtour_stage_result() the same way
-- 20260714020000_grandtour_apply_ttt_individual_time_result.sql already
-- extended apply_grandtour_official_stage_result(): a TTT stage whose
-- grandtour_stages.ttt_timing_rule is 'individual_time' can now be
-- admin-checked and finalised, counting grandtour_stage_team_result_lines
-- instead of grandtour_stage_result_lines. Every other TTT stage (null or
-- 'team_time' ttt_timing_rule) remains fully, unconditionally refused -
-- exactly as before - since there is still no derivation logic for that
-- rule.
--
-- Both signatures are byte-identical to the versions already created in
-- 20260710060000_grandtour_admin_check_finalise_authenticated_grants.sql
-- (uuid, uuid, text, text) - a safe same-OID `create or replace`, no drop
-- needed (see CLAUDE.md's Postgres gotcha note: that only applies when the
-- parameter LIST changes, which it doesn't here).

create or replace function public.mark_grandtour_stage_result_checked(
  p_stage_id uuid,
  p_checked_by uuid,
  p_note text default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage record;
  v_is_ttt boolean;
  v_result record;
  v_line_count int;
  v_jersey_count int;
begin
  if auth.role() <> 'service_role' and not grandtour_private.is_cycling_admin() then
    raise exception 'mark_grandtour_stage_result_checked: GrandTour administrator access is required.';
  end if;

  select stages.id, stages.stage_type, stages.ttt_timing_rule
  into v_stage
  from public.grandtour_stages stages
  where stages.id = p_stage_id;

  if v_stage.id is null then
    raise exception 'mark_grandtour_stage_result_checked: no grandtour_stages row found for stage_id %.', p_stage_id;
  end if;

  v_is_ttt := v_stage.stage_type::text in ('team_time_trial', 'ttt');

  if v_is_ttt and coalesce(v_stage.ttt_timing_rule::text, '') <> 'individual_time' then
    raise exception 'mark_grandtour_stage_result_checked: stage % is a TTT stage with ttt_timing_rule=%; only individual_time TTT stages are supported for admin-check.',
      p_stage_id, coalesce(v_stage.ttt_timing_rule::text, '(null)');
  end if;

  select results.id, results.review_status, results.is_final
  into v_result
  from public.grandtour_stage_results results
  where results.stage_id = p_stage_id;

  if v_result.id is null then
    raise exception 'mark_grandtour_stage_result_checked: stage % has no draft result; apply or enter a result first.', p_stage_id;
  end if;

  if v_result.is_final then
    raise exception 'mark_grandtour_stage_result_checked: stage % result is already final; a final result cannot be re-checked.', p_stage_id;
  end if;

  if v_is_ttt then
    select count(*) into v_line_count
    from public.grandtour_stage_team_result_lines lines
    where lines.stage_result_id = v_result.id;

    if v_line_count <> 10 then
      raise exception 'mark_grandtour_stage_result_checked: stage % has % team result line(s); exactly 10 are required for an individual_time TTT stage.', p_stage_id, v_line_count;
    end if;
  else
    select count(*) into v_line_count
    from public.grandtour_stage_result_lines lines
    where lines.stage_result_id = v_result.id;

    if v_line_count <> 10 then
      raise exception 'mark_grandtour_stage_result_checked: stage % has % result line(s); exactly 10 are required for a non-TTT stage.', p_stage_id, v_line_count;
    end if;
  end if;

  select count(*) into v_jersey_count
  from public.grandtour_stage_jersey_holders holders
  where holders.stage_id = p_stage_id;

  if v_jersey_count <> 4 then
    raise exception 'mark_grandtour_stage_result_checked: stage % has % jersey holder(s); exactly 4 (yellow, green, kom, white) are required.', p_stage_id, v_jersey_count;
  end if;

  update public.grandtour_stage_results
  set review_status = 'admin_checked',
      admin_checked_at = now(),
      admin_checked_by = p_checked_by,
      admin_check_note = p_note
  where id = v_result.id;

  insert into public.grandtour_result_audit_log (
    stage_id, stage_result_id, action, changed_by, reason, before_payload, after_payload
  ) values (
    p_stage_id,
    v_result.id,
    'admin_checked',
    p_checked_by,
    p_note,
    jsonb_build_object('review_status', v_result.review_status),
    jsonb_build_object('review_status', 'admin_checked', 'request_id', p_request_id)
  );

  return jsonb_build_object(
    'status', 'checked',
    'stage_id', p_stage_id,
    'stage_result_id', v_result.id,
    'review_status', 'admin_checked'
  );
end;
$$;

comment on function public.mark_grandtour_stage_result_checked(uuid, uuid, text, text) is
  'Records an admin review of a draft/imported GrandTour stage result (review_status -> admin_checked) after confirming exactly 10 lines (rider result lines for non-TTT/individual_time-TTT team result lines) and 4 jersey holders exist. TTT stages are only supported when ttt_timing_rule=individual_time; every other TTT stage is refused. Never scores, never finalizes. Logs to public.grandtour_result_audit_log. Requires grandtour_private.is_cycling_admin() internally; callable by service_role (CLI) or by an authenticated cycling admin''s own session (admin UI) - never by anon or a non-admin authenticated user.';

create or replace function public.finalize_grandtour_stage_result(
  p_stage_id uuid,
  p_finalized_by uuid,
  p_reason text default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage record;
  v_is_ttt boolean;
  v_result record;
  v_line_count int;
  v_jersey_count int;
  v_score_count int;
begin
  if auth.role() <> 'service_role' and not grandtour_private.is_cycling_admin() then
    raise exception 'finalize_grandtour_stage_result: GrandTour administrator access is required.';
  end if;

  select stages.id, stages.stage_type, stages.ttt_timing_rule
  into v_stage
  from public.grandtour_stages stages
  where stages.id = p_stage_id;

  if v_stage.id is null then
    raise exception 'finalize_grandtour_stage_result: no grandtour_stages row found for stage_id %.', p_stage_id;
  end if;

  v_is_ttt := v_stage.stage_type::text in ('team_time_trial', 'ttt');

  if v_is_ttt and coalesce(v_stage.ttt_timing_rule::text, '') <> 'individual_time' then
    raise exception 'finalize_grandtour_stage_result: stage % is a TTT stage with ttt_timing_rule=%; only individual_time TTT stages are supported for finalization.',
      p_stage_id, coalesce(v_stage.ttt_timing_rule::text, '(null)');
  end if;

  select results.id, results.is_final, results.review_status
  into v_result
  from public.grandtour_stage_results results
  where results.stage_id = p_stage_id;

  if v_result.id is null then
    raise exception 'finalize_grandtour_stage_result: stage % has no draft result; apply or enter a result first.', p_stage_id;
  end if;

  if v_result.is_final then
    return jsonb_build_object(
      'status', 'no_change',
      'stage_id', p_stage_id,
      'stage_result_id', v_result.id,
      'is_final', true,
      'review_status', v_result.review_status
    );
  end if;

  if v_result.review_status <> 'admin_checked' then
    raise exception 'finalize_grandtour_stage_result: stage % review_status is %, not admin_checked; run mark_grandtour_stage_result_checked first.', p_stage_id, v_result.review_status;
  end if;

  if v_is_ttt then
    select count(*) into v_line_count
    from public.grandtour_stage_team_result_lines lines
    where lines.stage_result_id = v_result.id;

    if v_line_count <> 10 then
      raise exception 'finalize_grandtour_stage_result: stage % has % team result line(s); exactly 10 are required to finalize an individual_time TTT stage.', p_stage_id, v_line_count;
    end if;
  else
    select count(*) into v_line_count
    from public.grandtour_stage_result_lines lines
    where lines.stage_result_id = v_result.id;

    if v_line_count <> 10 then
      raise exception 'finalize_grandtour_stage_result: stage % has % result line(s); exactly 10 are required to finalize a non-TTT stage.', p_stage_id, v_line_count;
    end if;
  end if;

  select count(*) into v_jersey_count
  from public.grandtour_stage_jersey_holders holders
  where holders.stage_id = p_stage_id;

  if v_jersey_count <> 4 then
    raise exception 'finalize_grandtour_stage_result: stage % has % jersey holder(s); exactly 4 (yellow, green, kom, white) are required to finalize.', p_stage_id, v_jersey_count;
  end if;

  select count(*) into v_score_count
  from public.grandtour_stage_scores scores
  where scores.stage_id = p_stage_id;

  if v_score_count > 0 then
    raise exception 'finalize_grandtour_stage_result: stage % already has % score row(s) while its result is still a draft; refusing to finalize an already-scored-looking stage without investigation. This function never modifies grandtour_stage_scores itself.', p_stage_id, v_score_count;
  end if;

  perform set_config('grandtour.request_id', coalesce(p_request_id, ''), true);
  perform set_config('grandtour.audit_reason', coalesce(p_reason, ''), true);

  update public.grandtour_stage_results
  set is_final = true,
      review_status = 'finalised',
      finalised_at = now(),
      finalised_by = p_finalized_by,
      finalisation_reason = p_reason
  where id = v_result.id;

  insert into public.grandtour_result_audit_log (
    stage_id, stage_result_id, action, changed_by, reason, before_payload, after_payload
  ) values (
    p_stage_id,
    v_result.id,
    'finalised',
    p_finalized_by,
    p_reason,
    jsonb_build_object('is_final', false, 'review_status', v_result.review_status),
    jsonb_build_object('is_final', true, 'review_status', 'finalised', 'request_id', p_request_id)
  );

  return jsonb_build_object(
    'status', 'finalized',
    'stage_id', p_stage_id,
    'stage_result_id', v_result.id,
    'is_final', true,
    'review_status', 'finalised'
  );
end;
$$;

comment on function public.finalize_grandtour_stage_result(uuid, uuid, text, text) is
  'Finalizes a GrandTour stage draft result (is_final -> true, review_status -> finalised) after confirming review_status=admin_checked, exactly 10 lines (rider result lines for non-TTT/individual_time-TTT team result lines), exactly 4 jersey holders, and no pre-existing score rows. TTT stages are only supported when ttt_timing_rule=individual_time; every other TTT stage is refused. Never modifies result lines or jersey holders, never scores. Logs to public.grandtour_result_audit_log. Requires grandtour_private.is_cycling_admin() internally; callable by service_role (CLI) or by an authenticated cycling admin''s own session (admin UI) - never by anon or a non-admin authenticated user.';
