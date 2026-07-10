-- Extends apply_grandtour_official_stage_result() (see
-- 20260709020000_grandtour_apply_official_stage_result_rpc.sql) to also
-- accept and upsert the four end-of-stage jersey holders (yellow, green,
-- kom, white) alongside the top-10 stage result, per
-- docs/grandtour-apply-mode-spec.md's jersey-holder reconciliation
-- extension. See scripts/grandtour-reconciliation.mjs's
-- reconcileJerseyHolders() and scripts/grandtour-apply.mjs's
-- selectJerseyHolderParams() for the Node-side counterpart that builds
-- p_jersey_holders.
--
-- This is a pure `create or replace function` extension: p_jersey_holders is
-- appended as a new final parameter with a default of '[]'::jsonb, so
-- existing callers that don't pass it (e.g. any already-generated report
-- replayed against this function) continue to work exactly as before and
-- simply write no jersey holders, matching prior behavior.
--
-- Still does NOT finalize (p_finalize remains hard-refused whenever true —
-- no CLI-level --finalize flag exists yet, so this restriction cannot
-- currently be bypassed) and still never touches
-- grandtour_stage_team_result_lines or grandtour_stage_scores or runs any
-- scoring function.
--
-- Postgres treats a change in argument list (8 params -> 9 params) as a
-- distinct overload, not a like-for-like replace of the prior function — a
-- plain `create or replace function` here would leave both the old 8-arg
-- and new 9-arg versions defined side by side. Both possible existing
-- signatures are explicitly dropped first so there is exactly one
-- apply_grandtour_official_stage_result function afterward, regardless of
-- which one (if either) is currently live; grants are re-established below
-- since dropping removes them.
--
-- The 9-arg drop exists because this exact migration previously failed
-- partway through in production: an earlier manual SQL attempt had already
-- created the 9-arg function, but the migration itself was never recorded
-- as applied (supabase_migrations.schema_migrations had no row for it), so
-- `supabase db push` retried the whole file and CREATE FUNCTION below hit
-- "already exists with same argument types". Dropping the 9-arg signature
-- too (in addition to the original 8-arg one) makes this migration safe to
-- (re)run regardless of which signature, if any, is already live.
drop function if exists public.apply_grandtour_official_stage_result(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  boolean,
  text,
  text,
  jsonb
);

drop function if exists public.apply_grandtour_official_stage_result(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  boolean,
  text,
  text
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
  -- v1 never finalizes. This is an explicit, always-on refusal rather than
  -- simply omitting the parameter, so a caller cannot finalize by mistake
  -- and so the refusal is directly testable.
  if p_finalize then
    raise exception 'apply_grandtour_official_stage_result: finalizing results (is_final=true) is not supported yet; this function only ever writes draft (is_final=false) results.';
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

  -- Stage lookup is authoritative; never trust p_reconciliation for this.
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

  -- Every rider in p_result_lines must actually be one of the riders
  -- p_reconciliation vouched for as "matched" — this stops a caller from
  -- pairing a clean-looking reconciliation payload with an unrelated set of
  -- result lines.
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

  -- p_jersey_holders is optional (defaults to an empty array, matching
  -- pre-existing callers), but when provided it must be exactly the four
  -- required jersey types, each vouched for by p_reconciliation.jerseyHolders
  -- as a "matched" entry — mirroring the p_result_lines guard above.
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
      -- Idempotent re-apply: result-line content is identical, so zero
      -- result-line writes occur. Jersey holders are still upserted below
      -- (on conflict (stage_id, jersey_type) do update) so that re-running
      -- apply with corrected jersey holders, but an unchanged top-10
      -- result, still lands the jersey correction — jersey-holder
      -- idempotency is enforced by the upsert itself, not by early-exiting
      -- here.
      v_status := 'no_change';
    else
      -- v1 foundation: any existing draft with DIFFERENT content is refused
      -- outright, regardless of whether it was previously written by this
      -- same function or by something else. docs/grandtour-apply-mode-spec.md
      -- §7.4/§12 discusses distinguishing "changed by a prior apply of this
      -- pipeline" from "manually corrected" as a possible future refinement;
      -- this foundation intentionally always requires an explicit, separate,
      -- human-reviewed correction step rather than silently overwriting.
      raise exception 'apply_grandtour_official_stage_result: stage % already has a different draft result; refusing to overwrite. A correction workflow is not implemented in v1.', v_stage.stage_number;
    end if;
  else
    insert into public.grandtour_stage_results (stage_id, is_final)
    values (p_stage_id, false)
    returning id into v_result_id;

    for v_line in select * from jsonb_array_elements(p_result_lines)
    loop
      insert into public.grandtour_stage_result_lines (stage_result_id, rider_id, actual_position)
      values (v_result_id, (v_line->>'rider_id')::uuid, (v_line->>'actual_position')::int);
    end loop;

    v_status := 'applied';
  end if;

  -- Jersey holders are upserted regardless of whether the result-line
  -- content above was new or unchanged (v_status 'applied' vs 'no_change'):
  -- grandtour_private.validate_jersey_holder() (20260629080958_grandtour_mvp.sql)
  -- requires a grandtour_stage_results row to already exist for this stage,
  -- which is now guaranteed either way by this point.
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
  'Database-side foundation for GrandTour official-letour apply mode (docs/grandtour-apply-mode-spec.md). Writes a DRAFT (is_final=false) stage result + result lines, and optionally the four end-of-stage jersey holders (yellow/green/kom/white), atomically for one non-TTT stage, after re-validating a caller-supplied reconciliation payload. Never finalizes, never writes team result lines, never scores tips. service_role only.';

revoke all on function public.apply_grandtour_official_stage_result(uuid, jsonb, jsonb, jsonb, jsonb, boolean, text, text, jsonb)
from public, anon, authenticated;

grant execute on function public.apply_grandtour_official_stage_result(uuid, jsonb, jsonb, jsonb, jsonb, boolean, text, text, jsonb)
to service_role;
