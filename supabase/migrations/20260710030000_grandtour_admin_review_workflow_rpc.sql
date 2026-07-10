-- Admin result-review workflow RPCs, on top of the schema added in
-- 20260710020000_grandtour_stage_result_review_workflow_schema.sql:
--   apply (draft/imported)  ->  admin_checked  ->  finalised  ->  score
--
-- 1. public.mark_grandtour_stage_result_checked(...) — new. Records that an
--    admin has reviewed a draft/imported result and its jersey holders
--    before it may be finalised. Never scores, never finalises.
-- 2. public.finalize_grandtour_stage_result(...) — redesigned from
--    20260710010000_grandtour_finalize_stage_result_rpc.sql: now requires
--    review_status='admin_checked' first (not just "any draft"), takes an
--    explicit p_finalized_by, and sets review_status='finalised' alongside
--    is_final=true. This is a genuine signature change (a new non-default
--    p_finalized_by parameter inserted before the existing optional ones),
--    so the prior 3-arg signature is dropped and this 4-arg one created
--    fresh, exactly like 20260709070000 did for the apply RPC's
--    p_jersey_holders addition. The prior finalize RPC has never been used
--    against production (no stage has ever been finalized there), so this
--    is not a breaking change to any real caller.
-- 3. public.apply_grandtour_official_stage_result(...) — same 9-arg
--    signature as 20260709070000 (create or replace in place, no drop
--    needed), extended only to: (a) tag newly-inserted draft rows with
--    review_status='imported'/source_mode='official_feed' instead of the
--    generic column defaults ('draft'/'official_feed'), so an
--    official-feed-imported row is visibly distinguished from a
--    from-scratch manual draft, and (b) write one
--    'official_import_applied' row to the new
--    public.grandtour_result_audit_log on a genuine 'applied' outcome
--    (never on 'no_change', matching the existing convention of not
--    duplicating audit/import-run rows on an idempotent reapply).
--    Nothing about apply's own validation, idempotency, or write scope
--    changes.

create function public.mark_grandtour_stage_result_checked(
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
  v_result record;
  v_line_count int;
  v_jersey_count int;
begin
  select stages.id, stages.stage_type
  into v_stage
  from public.grandtour_stages stages
  where stages.id = p_stage_id;

  if v_stage.id is null then
    raise exception 'mark_grandtour_stage_result_checked: no grandtour_stages row found for stage_id %.', p_stage_id;
  end if;

  if v_stage.stage_type::text in ('team_time_trial', 'ttt') then
    raise exception 'mark_grandtour_stage_result_checked: stage % is a TTT stage; TTT admin-check is not supported by this function.', p_stage_id;
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

  select count(*) into v_line_count
  from public.grandtour_stage_result_lines lines
  where lines.stage_result_id = v_result.id;

  if v_line_count <> 10 then
    raise exception 'mark_grandtour_stage_result_checked: stage % has % result line(s); exactly 10 are required for a non-TTT stage.', p_stage_id, v_line_count;
  end if;

  select count(*) into v_jersey_count
  from public.grandtour_stage_jersey_holders holders
  where holders.stage_id = p_stage_id;

  if v_jersey_count <> 4 then
    raise exception 'mark_grandtour_stage_result_checked: stage % has % jersey holder(s); exactly 4 (yellow, green, kom, white) are required for a non-TTT stage.', p_stage_id, v_jersey_count;
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
  'Records an admin review of a draft/imported GrandTour stage result (review_status -> admin_checked) after confirming exactly 10 result lines and 4 jersey holders exist for a non-TTT stage. Never scores, never finalizes. Logs to public.grandtour_result_audit_log. service_role only.';

revoke all on function public.mark_grandtour_stage_result_checked(uuid, uuid, text, text)
from public, anon, authenticated;

grant execute on function public.mark_grandtour_stage_result_checked(uuid, uuid, text, text)
to service_role;

-- Redesign of finalize_grandtour_stage_result: drop the 3-arg version from
-- 20260710010000, create the 4-arg version below.
drop function if exists public.finalize_grandtour_stage_result(uuid, text, text);

create function public.finalize_grandtour_stage_result(
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
  v_result record;
  v_line_count int;
  v_jersey_count int;
  v_score_count int;
begin
  select stages.id, stages.stage_type
  into v_stage
  from public.grandtour_stages stages
  where stages.id = p_stage_id;

  if v_stage.id is null then
    raise exception 'finalize_grandtour_stage_result: no grandtour_stages row found for stage_id %.', p_stage_id;
  end if;

  if v_stage.stage_type::text in ('team_time_trial', 'ttt') then
    raise exception 'finalize_grandtour_stage_result: stage % is a TTT stage; TTT finalization is not supported by this function.', p_stage_id;
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

  select count(*) into v_line_count
  from public.grandtour_stage_result_lines lines
  where lines.stage_result_id = v_result.id;

  if v_line_count <> 10 then
    raise exception 'finalize_grandtour_stage_result: stage % has % result line(s); exactly 10 are required to finalize a non-TTT stage.', p_stage_id, v_line_count;
  end if;

  select count(*) into v_jersey_count
  from public.grandtour_stage_jersey_holders holders
  where holders.stage_id = p_stage_id;

  if v_jersey_count <> 4 then
    raise exception 'finalize_grandtour_stage_result: stage % has % jersey holder(s); exactly 4 (yellow, green, kom, white) are required to finalize a non-TTT stage.', p_stage_id, v_jersey_count;
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
  'Finalizes a GrandTour stage draft result (is_final -> true, review_status -> finalised) for a non-TTT stage, after confirming review_status=admin_checked, exactly 10 result lines, exactly 4 jersey holders, and no pre-existing score rows. Never modifies result lines or jersey holders, never scores, never touches TTT stages. Logs to public.grandtour_result_audit_log. service_role only.';

revoke all on function public.finalize_grandtour_stage_result(uuid, uuid, text, text)
from public, anon, authenticated;

grant execute on function public.finalize_grandtour_stage_result(uuid, uuid, text, text)
to service_role;

-- apply_grandtour_official_stage_result: same signature as
-- 20260709070000_grandtour_apply_jersey_holders_rpc.sql, only the body
-- changes (review_status/source_mode tagging + official_import_applied
-- audit row on a genuine 'applied' outcome), so this is a plain
-- create-or-replace, not a drop+recreate.
create or replace function public.apply_grandtour_official_stage_result(
  p_stage_id uuid,
  p_result_lines jsonb,
  p_reconciliation jsonb,
  p_dry_run_status jsonb default '{}'::jsonb,
  p_source jsonb default '{}'::jsonb,
  p_finalize boolean default false,
  p_reason text default null,
  p_request_id text default null,
  p_jersey_holders jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage record;
  v_result_id uuid;
  v_existing_final boolean;
  v_incoming_lines jsonb;
  v_existing_lines jsonb;
  v_import_run_id uuid;
  v_line jsonb;
  v_provider_name text;
  v_status text;
  v_jersey_count int := 0;
begin
  if p_finalize then
    raise exception 'apply_grandtour_official_stage_result: finalizing results (is_final=true) is not supported here; use public.finalize_grandtour_stage_result() after public.mark_grandtour_stage_result_checked() instead.';
  end if;

  v_provider_name := p_source->>'provider_name';
  if coalesce(v_provider_name, '') <> 'official-letour' then
    raise exception 'apply_grandtour_official_stage_result: p_source.provider_name must be "official-letour" (got %).', v_provider_name;
  end if;

  if coalesce(p_dry_run_status->>'parserStatus', '') <> 'ok' then
    raise exception 'apply_grandtour_official_stage_result: p_dry_run_status.parserStatus must be "ok" (got %).', p_dry_run_status->>'parserStatus';
  end if;

  if coalesce((p_dry_run_status->>'parserDriftDetected')::boolean, true) is distinct from false then
    raise exception 'apply_grandtour_official_stage_result: p_dry_run_status.parserDriftDetected must be false.';
  end if;

  select stages.id, stages.stage_number, stages.stage_type, stages.grand_tour_id
  into v_stage
  from public.grandtour_stages stages
  where stages.id = p_stage_id;

  if v_stage.id is null then
    raise exception 'apply_grandtour_official_stage_result: no grandtour_stages row found for stage_id %.', p_stage_id;
  end if;

  if v_stage.stage_type::text in ('team_time_trial', 'ttt') then
    raise exception 'apply_grandtour_official_stage_result: stage % is a TTT stage; TTT results are not supported by this function.', v_stage.stage_number;
  end if;

  if p_reconciliation is null or jsonb_typeof(p_reconciliation) <> 'object' then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation must be a JSON object (the reconcileStageResult() output for this stage).';
  end if;

  if coalesce((p_reconciliation->>'stageNumber')::int, -1) <> v_stage.stage_number then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation.stageNumber (%) does not match stage_id % (stage_number %).',
      p_reconciliation->>'stageNumber', p_stage_id, v_stage.stage_number;
  end if;

  if coalesce((p_reconciliation->>'isTtt')::boolean, true) is distinct from false then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation.isTtt must be false.';
  end if;

  if coalesce((p_reconciliation->>'missingStageRecord')::boolean, true) is distinct from false then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation.missingStageRecord must be false.';
  end if;

  if coalesce((p_reconciliation->>'startlistValidationPassed')::boolean, false) is distinct from true then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation.startlistValidationPassed must be true.';
  end if;

  if jsonb_array_length(coalesce(p_reconciliation->'unmatchedRiders', '[]'::jsonb)) <> 0 then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation.unmatchedRiders must be empty.';
  end if;

  if jsonb_array_length(coalesce(p_reconciliation->'ambiguousRiders', '[]'::jsonb)) <> 0 then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation.ambiguousRiders must be empty.';
  end if;

  if jsonb_array_length(coalesce(p_reconciliation->'unmatchedTeams', '[]'::jsonb)) <> 0 then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation.unmatchedTeams must be empty.';
  end if;

  if jsonb_array_length(coalesce(p_reconciliation->'ambiguousTeams', '[]'::jsonb)) <> 0 then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation.ambiguousTeams must be empty.';
  end if;

  if jsonb_array_length(coalesce(p_reconciliation->'duplicateBibConflicts', '[]'::jsonb)) <> 0 then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation.duplicateBibConflicts must be empty.';
  end if;

  if coalesce((p_reconciliation->>'safeToApply')::boolean, false) is distinct from true then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation.safeToApply must be true.';
  end if;

  if p_result_lines is null or jsonb_typeof(p_result_lines) <> 'array' then
    raise exception 'apply_grandtour_official_stage_result: p_result_lines must be a JSON array of {"rider_id": uuid, "actual_position": int}.';
  end if;

  if jsonb_array_length(p_result_lines) not in (5, 10) then
    raise exception 'apply_grandtour_official_stage_result: p_result_lines must contain exactly 5 or 10 rows (got %).', jsonb_array_length(p_result_lines);
  end if;

  if (select count(distinct elem->>'rider_id') from jsonb_array_elements(p_result_lines) elem) <> jsonb_array_length(p_result_lines) then
    raise exception 'apply_grandtour_official_stage_result: p_result_lines contains duplicate rider_id values.';
  end if;

  if (select count(distinct (elem->>'actual_position')) from jsonb_array_elements(p_result_lines) elem) <> jsonb_array_length(p_result_lines) then
    raise exception 'apply_grandtour_official_stage_result: p_result_lines contains duplicate actual_position values.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_result_lines) line
    where not exists (
      select 1
      from jsonb_array_elements(coalesce(p_reconciliation->'matchedRiders', '[]'::jsonb)) matched
      where matched->>'riderId' = line->>'rider_id'
    )
  ) then
    raise exception 'apply_grandtour_official_stage_result: p_result_lines contains a rider_id not present in p_reconciliation.matchedRiders.';
  end if;

  if p_jersey_holders is null or jsonb_typeof(p_jersey_holders) <> 'array' then
    raise exception 'apply_grandtour_official_stage_result: p_jersey_holders must be a JSON array of {"jersey_type": text, "rider_id": uuid}.';
  end if;

  if jsonb_array_length(p_jersey_holders) not in (0, 4) then
    raise exception 'apply_grandtour_official_stage_result: p_jersey_holders must contain exactly 0 or 4 entries (got %).', jsonb_array_length(p_jersey_holders);
  end if;

  if jsonb_array_length(p_jersey_holders) = 4 then
    if exists (
      select 1 from jsonb_array_elements(p_jersey_holders) elem
      where elem->>'jersey_type' not in ('yellow', 'green', 'kom', 'white')
    ) then
      raise exception 'apply_grandtour_official_stage_result: p_jersey_holders contains an invalid jersey_type; must be one of yellow, green, kom, white.';
    end if;

    if (select count(distinct elem->>'jersey_type') from jsonb_array_elements(p_jersey_holders) elem) <> 4 then
      raise exception 'apply_grandtour_official_stage_result: p_jersey_holders must contain exactly one entry per jersey_type (yellow, green, kom, white), no duplicates.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_jersey_holders) jh
      where not exists (
        select 1
        from jsonb_array_elements(coalesce(p_reconciliation->'jerseyHolders', '[]'::jsonb)) recon_jh
        where recon_jh->>'jerseyType' = jh->>'jersey_type'
          and recon_jh->>'matchedRiderId' = jh->>'rider_id'
          and recon_jh->>'status' = 'matched'
      )
    ) then
      raise exception 'apply_grandtour_official_stage_result: p_jersey_holders contains a jersey_type/rider_id not present as a matched entry in p_reconciliation.jerseyHolders.';
    end if;
  end if;

  select jsonb_agg(jsonb_build_object('rider_id', elem->>'rider_id', 'actual_position', (elem->>'actual_position')::int) order by (elem->>'actual_position')::int)
  into v_incoming_lines
  from jsonb_array_elements(p_result_lines) elem;

  select results.id, results.is_final
  into v_result_id, v_existing_final
  from public.grandtour_stage_results results
  where results.stage_id = p_stage_id;

  if v_result_id is not null and v_existing_final then
    raise exception 'apply_grandtour_official_stage_result: stage % already has a FINAL result; finalized results cannot be modified by this function.', v_stage.stage_number;
  end if;

  if v_result_id is not null then
    select jsonb_agg(jsonb_build_object('rider_id', lines.rider_id::text, 'actual_position', lines.actual_position) order by lines.actual_position)
    into v_existing_lines
    from public.grandtour_stage_result_lines lines
    where lines.stage_result_id = v_result_id;

    if coalesce(v_existing_lines, '[]'::jsonb) = coalesce(v_incoming_lines, '[]'::jsonb) then
      v_status := 'no_change';
    else
      raise exception 'apply_grandtour_official_stage_result: stage % already has a different draft result; refusing to overwrite. A correction workflow is not implemented in v1.', v_stage.stage_number;
    end if;
  else
    insert into public.grandtour_stage_results (stage_id, is_final, review_status, source_mode)
    values (p_stage_id, false, 'imported', 'official_feed')
    returning id into v_result_id;

    for v_line in select * from jsonb_array_elements(p_result_lines)
    loop
      insert into public.grandtour_stage_result_lines (stage_result_id, rider_id, actual_position)
      values (v_result_id, (v_line->>'rider_id')::uuid, (v_line->>'actual_position')::int);
    end loop;

    v_status := 'applied';
  end if;

  if jsonb_array_length(p_jersey_holders) = 4 then
    for v_line in select * from jsonb_array_elements(p_jersey_holders)
    loop
      insert into public.grandtour_stage_jersey_holders (stage_id, jersey_type, rider_id)
      values (p_stage_id, (v_line->>'jersey_type')::public.grandtour_jersey_type, (v_line->>'rider_id')::uuid)
      on conflict (stage_id, jersey_type)
      do update set rider_id = excluded.rider_id, updated_at = now();
      v_jersey_count := v_jersey_count + 1;
    end loop;
  end if;

  if v_status = 'no_change' then
    return jsonb_build_object(
      'status', 'no_change',
      'stage_id', p_stage_id,
      'stage_result_id', v_result_id,
      'line_count', jsonb_array_length(v_incoming_lines),
      'jersey_holder_count', v_jersey_count
    );
  end if;

  insert into public.grandtour_feed_import_runs (
    grand_tour_id, provider_name, source_url, mode, import_status, fetched_at, applied_at, summary
  ) values (
    v_stage.grand_tour_id,
    v_provider_name,
    p_source->>'source_url',
    'apply',
    'applied',
    coalesce((p_source->>'fetched_at')::timestamptz, now()),
    now(),
    jsonb_build_object(
      'stage_id', p_stage_id,
      'stage_number', v_stage.stage_number,
      'stage_result_id', v_result_id,
      'line_count', jsonb_array_length(p_result_lines),
      'jersey_holder_count', v_jersey_count,
      'reconciliation', p_reconciliation,
      'dry_run_status', p_dry_run_status,
      'reason', p_reason,
      'request_id', p_request_id
    )
  )
  returning id into v_import_run_id;

  insert into public.grandtour_feed_snapshots (
    import_run_id, segment, source_name, source_url, fetched_at, confidence, raw_payload, normalized_payload
  ) values (
    v_import_run_id,
    'stage_result',
    v_provider_name,
    p_source->>'source_url',
    coalesce((p_source->>'fetched_at')::timestamptz, now()),
    coalesce(p_source->>'confidence', 'official'),
    p_result_lines,
    v_incoming_lines
  );

  insert into public.grandtour_result_audit_log (
    stage_id, stage_result_id, action, changed_by, reason, before_payload, after_payload
  ) values (
    p_stage_id,
    v_result_id,
    'official_import_applied',
    null,
    p_reason,
    null,
    jsonb_build_object(
      'line_count', jsonb_array_length(p_result_lines),
      'jersey_holder_count', v_jersey_count,
      'import_run_id', v_import_run_id,
      'request_id', p_request_id
    )
  );

  return jsonb_build_object(
    'status', 'applied',
    'stage_id', p_stage_id,
    'stage_result_id', v_result_id,
    'import_run_id', v_import_run_id,
    'line_count', jsonb_array_length(p_result_lines),
    'jersey_holder_count', v_jersey_count
  );
end;
$$;

comment on function public.apply_grandtour_official_stage_result(uuid, jsonb, jsonb, jsonb, jsonb, boolean, text, text, jsonb) is
  'Database-side foundation for GrandTour official-letour apply mode (docs/grandtour-apply-mode-spec.md). Writes a DRAFT (is_final=false, review_status=imported) stage result + result lines, and optionally the four end-of-stage jersey holders (yellow/green/kom/white), atomically for one non-TTT stage, after re-validating a caller-supplied reconciliation payload. Never finalizes, never writes team result lines, never scores tips. Admin review (mark_grandtour_stage_result_checked) and finalization (finalize_grandtour_stage_result) are separate, later steps. Logs to public.grandtour_result_audit_log. service_role only.';

revoke all on function public.apply_grandtour_official_stage_result(uuid, jsonb, jsonb, jsonb, jsonb, boolean, text, text, jsonb)
from public, anon, authenticated;

grant execute on function public.apply_grandtour_official_stage_result(uuid, jsonb, jsonb, jsonb, jsonb, boolean, text, text, jsonb)
to service_role;
