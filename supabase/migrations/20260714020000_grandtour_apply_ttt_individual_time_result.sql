-- Extends apply_grandtour_official_stage_result() to support TTT stages
-- whose grandtour_stages.ttt_timing_rule is 'individual_time' - i.e. the
-- UCI's "N=1" rule (a team's official time is the time of the first rider
-- from that team to cross the line; every other rider is timed
-- individually), which Tour de France 2026 Stage 1 already uses per
-- 20260703025324_add_grandtour_ttt_schema_support.sql's own seed update.
-- letour.fr publishes no separate team-classification table for this - the
-- team result is derived client-side (scripts/grandtour-reconciliation.mjs's
-- deriveTeamResultFromRiderRows/reconcileTeamTimeTrialResult) from the same
-- per-rider ranking table already used for every other stage, by taking
-- each team's minimum rider time. This migration is the write path for
-- that derived result; it does not change how the result is derived.
--
-- A TTT stage whose ttt_timing_rule is NOT 'individual_time' (null, or the
-- older shared-block-time 'team_time' rule) remains fully, unconditionally
-- refused, exactly as before - there is no derivation logic for that rule
-- yet, and this migration does not add one.
--
-- Signature change (new p_team_result_lines parameter): per the Postgres
-- gotcha in CLAUDE.md, a changed parameter list is NOT a same-OID
-- `create or replace function` - it would silently leave both the old
-- 9-arg and new 10-arg overloads defined. The old signature is dropped
-- explicitly before recreating it.
drop function if exists public.apply_grandtour_official_stage_result(
  uuid, jsonb, jsonb, jsonb, jsonb, boolean, text, text, jsonb
);

create function public.apply_grandtour_official_stage_result(
  p_stage_id uuid,
  p_result_lines jsonb,
  p_reconciliation jsonb,
  p_dry_run_status jsonb default '{}'::jsonb,
  p_source jsonb default '{}'::jsonb,
  p_finalize boolean default false,
  p_reason text default null,
  p_request_id text default null,
  p_jersey_holders jsonb default '[]'::jsonb,
  p_team_result_lines jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage record;
  v_is_ttt boolean;
  v_result_id uuid;
  v_existing_final boolean;
  v_incoming_lines jsonb;
  v_existing_lines jsonb;
  v_incoming_team_lines jsonb;
  v_existing_team_lines jsonb;
  v_import_run_id uuid;
  v_line jsonb;
  v_provider_name text;
  v_status text;
  v_jersey_count int := 0;
  v_rider_line_count int := 0;
  v_team_line_count int := 0;
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

  select stages.id, stages.stage_number, stages.stage_type, stages.ttt_timing_rule, stages.grand_tour_id
  into v_stage
  from public.grandtour_stages stages
  where stages.id = p_stage_id;

  if v_stage.id is null then
    raise exception 'apply_grandtour_official_stage_result: no grandtour_stages row found for stage_id %.', p_stage_id;
  end if;

  v_is_ttt := v_stage.stage_type::text in ('team_time_trial', 'ttt');

  if v_is_ttt and coalesce(v_stage.ttt_timing_rule::text, '') <> 'individual_time' then
    raise exception 'apply_grandtour_official_stage_result: stage % is a TTT stage with ttt_timing_rule=%; only individual_time TTT stages are supported by this function.',
      v_stage.stage_number, coalesce(v_stage.ttt_timing_rule::text, '(null)');
  end if;

  if p_reconciliation is null or jsonb_typeof(p_reconciliation) <> 'object' then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation must be a JSON object (the reconcileStageResult() output for this stage).';
  end if;

  if coalesce((p_reconciliation->>'stageNumber')::int, -1) <> v_stage.stage_number then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation.stageNumber (%) does not match stage_id % (stage_number %).',
      p_reconciliation->>'stageNumber', p_stage_id, v_stage.stage_number;
  end if;

  if coalesce((p_reconciliation->>'isTtt')::boolean, not v_is_ttt) is distinct from v_is_ttt then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation.isTtt (%) does not match stage %''s actual TTT status (%).',
      p_reconciliation->>'isTtt', v_stage.stage_number, v_is_ttt;
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

  if v_is_ttt and jsonb_array_length(coalesce(p_reconciliation->'tttTeamResult'->'blockers', '[]'::jsonb)) <> 0 then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation.tttTeamResult.blockers must be empty (got %).',
      p_reconciliation->'tttTeamResult'->'blockers';
  end if;

  if coalesce((p_reconciliation->>'safeToApply')::boolean, false) is distinct from true then
    raise exception 'apply_grandtour_official_stage_result: p_reconciliation.safeToApply must be true.';
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

  -- --- Branch: TTT (individual_time, already confirmed above) vs non-TTT ---
  if v_is_ttt then
    if coalesce(jsonb_array_length(p_result_lines), 0) <> 0 then
      raise exception 'apply_grandtour_official_stage_result: p_result_lines must be empty for a TTT stage; use p_team_result_lines instead.';
    end if;

    if p_team_result_lines is null or jsonb_typeof(p_team_result_lines) <> 'array' then
      raise exception 'apply_grandtour_official_stage_result: p_team_result_lines must be a JSON array of {"team_id": uuid, "actual_position": int}.';
    end if;

    if jsonb_array_length(p_team_result_lines) not in (5, 10) then
      raise exception 'apply_grandtour_official_stage_result: p_team_result_lines must contain exactly 5 or 10 rows (got %).', jsonb_array_length(p_team_result_lines);
    end if;

    if (select count(distinct elem->>'team_id') from jsonb_array_elements(p_team_result_lines) elem) <> jsonb_array_length(p_team_result_lines) then
      raise exception 'apply_grandtour_official_stage_result: p_team_result_lines contains duplicate team_id values.';
    end if;

    if (select count(distinct (elem->>'actual_position')) from jsonb_array_elements(p_team_result_lines) elem) <> jsonb_array_length(p_team_result_lines) then
      raise exception 'apply_grandtour_official_stage_result: p_team_result_lines contains duplicate actual_position values.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_team_result_lines) line
      where not exists (
        select 1
        from jsonb_array_elements(coalesce(p_reconciliation->'tttTeamResult'->'teams', '[]'::jsonb)) derived
        where derived->>'teamId' = line->>'team_id'
          and (derived->>'position')::int = (line->>'actual_position')::int
      )
    ) then
      raise exception 'apply_grandtour_official_stage_result: p_team_result_lines contains a team_id/actual_position pair not present in p_reconciliation.tttTeamResult.teams.';
    end if;

    select jsonb_agg(jsonb_build_object('team_id', elem->>'team_id', 'actual_position', (elem->>'actual_position')::int) order by (elem->>'actual_position')::int)
    into v_incoming_team_lines
    from jsonb_array_elements(p_team_result_lines) elem;

    select results.id, results.is_final
    into v_result_id, v_existing_final
    from public.grandtour_stage_results results
    where results.stage_id = p_stage_id;

    if v_result_id is not null and v_existing_final then
      raise exception 'apply_grandtour_official_stage_result: stage % already has a FINAL result; finalized results cannot be modified by this function.', v_stage.stage_number;
    end if;

    if v_result_id is not null then
      select jsonb_agg(jsonb_build_object('team_id', lines.team_id::text, 'actual_position', lines.actual_position) order by lines.actual_position)
      into v_existing_team_lines
      from public.grandtour_stage_team_result_lines lines
      where lines.stage_result_id = v_result_id;

      if coalesce(v_existing_team_lines, '[]'::jsonb) = coalesce(v_incoming_team_lines, '[]'::jsonb) then
        v_status := 'no_change';
      else
        raise exception 'apply_grandtour_official_stage_result: stage % already has a different draft result; refusing to overwrite. A correction workflow is not implemented for TTT team results.', v_stage.stage_number;
      end if;
    else
      insert into public.grandtour_stage_results (stage_id, is_final, review_status, source_mode)
      values (p_stage_id, false, 'imported', 'official_feed')
      returning id into v_result_id;

      for v_line in select * from jsonb_array_elements(p_team_result_lines)
      loop
        insert into public.grandtour_stage_team_result_lines (stage_result_id, team_id, actual_position)
        values (v_result_id, (v_line->>'team_id')::uuid, (v_line->>'actual_position')::int);
      end loop;

      v_status := 'applied';
    end if;

    v_team_line_count := jsonb_array_length(p_team_result_lines);
  else
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

    if coalesce(jsonb_array_length(p_team_result_lines), 0) <> 0 then
      raise exception 'apply_grandtour_official_stage_result: p_team_result_lines must be empty for a non-TTT stage; use p_result_lines instead.';
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

    v_rider_line_count := jsonb_array_length(p_result_lines);
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
      'line_count', v_rider_line_count,
      'team_line_count', v_team_line_count,
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
      'line_count', v_rider_line_count,
      'team_line_count', v_team_line_count,
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
    case when v_is_ttt then 'ttt_result' else 'stage_result' end,
    v_provider_name,
    p_source->>'source_url',
    coalesce((p_source->>'fetched_at')::timestamptz, now()),
    coalesce(p_source->>'confidence', 'official'),
    case when v_is_ttt then p_team_result_lines else p_result_lines end,
    case when v_is_ttt then v_incoming_team_lines else v_incoming_lines end
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
      'line_count', v_rider_line_count,
      'team_line_count', v_team_line_count,
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
    'line_count', v_rider_line_count,
    'team_line_count', v_team_line_count,
    'jersey_holder_count', v_jersey_count
  );
end;
$$;

comment on function public.apply_grandtour_official_stage_result(uuid, jsonb, jsonb, jsonb, jsonb, boolean, text, text, jsonb, jsonb) is
  'Applies a reviewed official-letour dry-run/reconcile report as a draft (is_final=false) GrandTour stage result. Non-TTT and team_time-rule TTT stages: top-N rider result lines (unchanged v1 behaviour, team_time TTT still unconditionally refused). individual_time-rule TTT stages (e.g. TDF 2026 Stage 1): top-N team result lines, derived client-side from the UCI N=1 rule and written to grandtour_stage_team_result_lines instead. Up to 4 jersey holders either way. Re-validates the reconciliation payload server-side, refuses p_finalize=true unconditionally, idempotent on unchanged content. Requires grandtour_private.is_cycling_admin() internally; callable by service_role (CLI, scripts/grandtour-feed-import.mjs --apply) or by an authenticated cycling admin''s own session (admin UI, apps/mobile/api/admin/grandtour/apply-official-result.mjs) - never by anon or a non-admin authenticated user.';

-- A fresh `create function` (this is a drop+recreate, not an in-place
-- `create or replace`, per the signature-change gotcha above) grants
-- EXECUTE to PUBLIC by default and starts with no service_role grant at
-- all - both must be fixed explicitly here, exactly as
-- 20260709070000_grandtour_apply_jersey_holders_rpc.sql already had to do
-- the last time this function's signature changed (see CLAUDE.md's
-- Postgres gotcha notes).
revoke all on function public.apply_grandtour_official_stage_result(uuid, jsonb, jsonb, jsonb, jsonb, boolean, text, text, jsonb, jsonb)
from public, anon, authenticated;

grant execute on function public.apply_grandtour_official_stage_result(uuid, jsonb, jsonb, jsonb, jsonb, boolean, text, text, jsonb, jsonb)
to service_role, authenticated;
