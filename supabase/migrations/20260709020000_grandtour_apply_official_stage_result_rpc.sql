-- Database-side foundation for GrandTour official-letour apply mode.
-- See docs/grandtour-apply-mode-spec.md, especially the Phase 0 findings
-- (docs/grandtour-apply-mode-spec.md#13-phase-0-verification-results) this
-- migration directly acts on.
--
-- This migration:
--   1. Closes the previously-verified grant gap on grandtour_feed_import_runs
--      / grandtour_feed_snapshots (spec §13.2) so the audit trail this RPC
--      writes to is actually reachable by service_role.
--   2. Adds public.apply_grandtour_official_stage_result(...), a
--      security-definer RPC that atomically writes a DRAFT (is_final=false)
--      grandtour_stage_results + grandtour_stage_result_lines set for a
--      single non-TTT stage, after re-validating the caller-supplied
--      dry-run/reconciliation payload server-side.
--
-- This migration does NOT wire anything into the Node CLI
-- (scripts/grandtour-feed-import.mjs is untouched) and does NOT grant
-- EXECUTE to anon or authenticated — only service_role may call this
-- function, matching the existing service-role-only precedent in
-- scripts/import-tdf-2026.mjs. Jersey holders, team result lines, tip
-- scoring, and finalization (is_final=true) remain entirely out of scope
-- and are actively refused inside the function body (see comments below).

-- 1. Close the grant gap confirmed in docs/grandtour-apply-mode-spec.md §13.2.
-- These two tables previously had zero SELECT/INSERT/UPDATE/DELETE grants
-- for any role, including service_role (only schema-level REFERENCES/
-- TRIGGER/TRUNCATE), because the migration that created them
-- (20260707024106_park_jersey_tips_add_rider_feed_metadata.sql) added RLS
-- policies but never the corresponding table-level grant.
grant select, insert, update, delete
on table public.grandtour_feed_import_runs, public.grandtour_feed_snapshots
to service_role;

-- 2. The apply RPC.
--
-- Inputs are JSONB so the Node layer can pass along the exact review/
-- reconciliation report objects scripts/grandtour-feed-provider.mjs and
-- scripts/grandtour-reconciliation.mjs already produce, once a future task
-- wires a CLI apply path to call this function. This migration does not add
-- that wiring.
--
-- p_reconciliation is expected to be exactly one entry of the
-- `reconciliation.stages[]` array produced by reconcileStageResult() in
-- scripts/grandtour-reconciliation.mjs, i.e. an object with (at least):
--   stageNumber, isTtt, missingStageRecord, matchedRiders (array of
--   {riderId, ...}), unmatchedRiders, ambiguousRiders, unmatchedTeams,
--   ambiguousTeams, duplicateBibConflicts, startlistValidationPassed,
--   safeToApply.
--
-- p_dry_run_status is expected to carry the relevant fields from the outer
-- dry-run review object: { "parserDriftDetected": false, "parserStatus": "ok" }.
--
-- p_source carries source provenance for the audit tables:
--   { "provider_name": "official-letour", "source_url": "...",
--     "fetched_at": "2026-07-09T00:00:00Z", "confidence": "official" }
--
-- The function independently re-derives stage_id, stage_number, and
-- stage_type from grandtour_stages (never trusts the payload for those),
-- and relies on the pre-existing grandtour_private.validate_result_line()
-- trigger to enforce startlist membership at write time (defense in depth
-- on top of the p_reconciliation.startlistValidationPassed check).
create or replace function public.apply_grandtour_official_stage_result(
  p_stage_id uuid,
  p_result_lines jsonb,
  p_reconciliation jsonb,
  p_dry_run_status jsonb default '{}'::jsonb,
  p_source jsonb default '{}'::jsonb,
  p_finalize boolean default false,
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
  v_result_id uuid;
  v_existing_final boolean;
  v_incoming_lines jsonb;
  v_existing_lines jsonb;
  v_import_run_id uuid;
  v_line jsonb;
  v_provider_name text;
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
      -- Idempotent re-apply: identical content, zero writes.
      return jsonb_build_object(
        'status', 'no_change',
        'stage_id', p_stage_id,
        'stage_result_id', v_result_id,
        'line_count', jsonb_array_length(v_incoming_lines)
      );
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
  end if;

  insert into public.grandtour_stage_results (stage_id, is_final)
  values (p_stage_id, false)
  returning id into v_result_id;

  for v_line in select * from jsonb_array_elements(p_result_lines)
  loop
    insert into public.grandtour_stage_result_lines (stage_result_id, rider_id, actual_position)
    values (v_result_id, (v_line->>'rider_id')::uuid, (v_line->>'actual_position')::int);
  end loop;

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
    'line_count', jsonb_array_length(p_result_lines)
  );
end;
$$;

comment on function public.apply_grandtour_official_stage_result(uuid, jsonb, jsonb, jsonb, jsonb, boolean, text, text) is
  'Database-side foundation for GrandTour official-letour apply mode (docs/grandtour-apply-mode-spec.md). Writes a DRAFT (is_final=false) stage result + result lines atomically for one non-TTT stage, after re-validating a caller-supplied reconciliation payload. Never finalizes, never writes jersey holders or team result lines, never scores tips. service_role only.';

revoke all on function public.apply_grandtour_official_stage_result(uuid, jsonb, jsonb, jsonb, jsonb, boolean, text, text)
from public, anon, authenticated;

grant execute on function public.apply_grandtour_official_stage_result(uuid, jsonb, jsonb, jsonb, jsonb, boolean, text, text)
to service_role;
