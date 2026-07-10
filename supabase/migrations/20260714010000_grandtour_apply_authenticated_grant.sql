-- Allows public.apply_grandtour_official_stage_result(...) to be called
-- directly from an authenticated cycling admin's own Supabase session (the
-- Vercel-safe frontend path, apps/mobile/api/admin/grandtour/apply-official-result.mjs),
-- not only via the service-role CLI/SQL path
-- (scripts/grandtour-feed-import.mjs --apply). This is the same extension
-- 20260710060000_grandtour_admin_check_finalise_authenticated_grants.sql
-- already made for mark_grandtour_stage_result_checked/
-- finalize_grandtour_stage_result: add an internal guard -
-- `auth.role() = 'service_role' or grandtour_private.is_cycling_admin()` -
-- as the first thing the function does, then grant EXECUTE to
-- `authenticated` alongside the existing service_role grant. Without the
-- internal guard, granting EXECUTE alone would let any signed-in user
-- apply a result for any stage, since `security definer` runs with the
-- owning role's privileges regardless of caller.
--
-- The signature (9 args) is byte-identical to the version created in
-- 20260710030000_grandtour_admin_review_workflow_rpc.sql, so `create or
-- replace function` is a safe same-OID replace here - only the function
-- body gains one new guard clause (see CLAUDE.md's Postgres gotcha note:
-- a parameter-list change would require an explicit drop first; nothing
-- about the parameter list changes in this migration).
--
-- Nothing else about apply's own validation, idempotency, refusal of
-- p_finalize=true, or write scope changes. p_reason/p_request_id/the
-- audit log's `changed_by` (still hardcoded null - apply has no
-- p_applied_by parameter, unlike mark-checked/finalize's explicit
-- p_checked_by/p_finalized_by - a known, pre-existing gap left alone here
-- to keep this migration a single, minimal, well-tested change) are
-- unaffected.
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
  if auth.role() <> 'service_role' and not grandtour_private.is_cycling_admin() then
    raise exception 'apply_grandtour_official_stage_result: GrandTour administrator access is required.';
  end if;

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
  'Applies a reviewed official-letour dry-run/reconcile report as a draft (is_final=false) GrandTour stage result: top-N result lines + up to 4 jersey holders. Re-validates the reconciliation payload server-side, refuses TTT stages and p_finalize=true unconditionally, idempotent on unchanged content. Requires grandtour_private.is_cycling_admin() internally; callable by service_role (CLI, scripts/grandtour-feed-import.mjs --apply) or by an authenticated cycling admin''s own session (admin UI, apps/mobile/api/admin/grandtour/apply-official-result.mjs) - never by anon or a non-admin authenticated user.';

grant execute on function public.apply_grandtour_official_stage_result(uuid, jsonb, jsonb, jsonb, jsonb, boolean, text, text, jsonb)
to authenticated;
