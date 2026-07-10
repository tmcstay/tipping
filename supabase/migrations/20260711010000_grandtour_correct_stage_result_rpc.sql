-- Part C: a controlled, audited correction/re-import workflow for GrandTour
-- stage results, for when a stage was missed, the official feed was wrong
-- or incomplete, the parser was fixed after a bad import, jersey holder
-- info was wrong, or an admin finds an error after review/finalisation/
-- scoring. See docs/GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md
-- §16 for the full workflow this supports.
--
-- public.correct_grandtour_stage_result_from_reviewed_report(...) is a
-- SEPARATE function from apply_grandtour_official_stage_result, not an
-- extra parameter on it: apply's own "already has a different draft
-- result; refusing to overwrite" refusal and its "already has a FINAL
-- result; finalized results cannot be modified" refusal are both
-- deliberate safety rails from the original apply-mode design (see
-- docs/grandtour-apply-mode-spec.md) - overloading apply with a bypass
-- flag would weaken those rails for every caller. A dedicated function
-- keeps "first import" (apply, still refuses to touch an existing
-- different/final result) and "correction" (this function, the ONLY path
-- allowed to touch an existing/final result, and only when every gate
-- below passes) unambiguous and separately auditable.
--
-- Trigger-ordering note (load-bearing): grandtour_stage_result_lines and
-- grandtour_stage_jersey_holders both have "prevent final delete" triggers
-- (grandtour_stage_result_lines_prevent_final_delete /
-- grandtour_stage_jersey_holders_prevent_final_delete, from
-- 20260629080958_grandtour_mvp.sql) that block DELETE while their parent
-- grandtour_stage_results.is_final is true. This function therefore flips
-- is_final to false FIRST (as part of the same transaction/function call),
-- before deleting/reinserting any line or jersey-holder rows - reversing
-- this order would make correcting an already-finalised stage fail outright.

create function public.correct_grandtour_stage_result_from_reviewed_report(
  p_stage_id uuid,
  p_result_lines jsonb,
  p_jersey_holders jsonb,
  p_reconciliation jsonb,
  p_reason text,
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
  v_incoming_lines jsonb;
  v_existing_lines jsonb;
  v_incoming_jerseys jsonb;
  v_existing_jerseys jsonb;
  v_before_score_count int;
  v_was_finalised boolean;
  v_scores_cleared int := 0;
  v_line jsonb;
  v_before_payload jsonb;
  v_after_payload jsonb;
begin
  -- Gate 1: same service_role-or-admin pattern as mark_grandtour_stage_result_checked/
  -- finalize_grandtour_stage_result (20260710060000). A correction is at
  -- least as sensitive as either of those, so it gets the same guard.
  if auth.role() <> 'service_role' and not grandtour_private.is_cycling_admin() then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: GrandTour administrator access is required.';
  end if;

  -- Gate 2: an explicit, non-blank reason is mandatory - corrections must
  -- be explicit and auditable, never silent.
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_reason is required and cannot be blank.';
  end if;

  select stages.id, stages.stage_number, stages.stage_type
  into v_stage
  from public.grandtour_stages stages
  where stages.id = p_stage_id;

  if v_stage.id is null then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: no grandtour_stages row found for stage_id %.', p_stage_id;
  end if;

  if v_stage.stage_type::text in ('team_time_trial', 'ttt') then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: stage % is a TTT stage; TTT corrections are not supported by this function.', v_stage.stage_number;
  end if;

  select results.id, results.is_final, results.review_status
  into v_result
  from public.grandtour_stage_results results
  where results.stage_id = p_stage_id;

  -- Gate 3: this function only ever corrects an EXISTING result (draft or
  -- final). A stage with no result at all has nothing to correct - use
  -- apply_grandtour_official_stage_result for a first import instead.
  if v_result.id is null then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: stage % has no existing result to correct; use apply_grandtour_official_stage_result for a first import.', v_stage.stage_number;
  end if;

  -- Gate 4: p_reconciliation must describe a genuinely safe-to-apply
  -- reviewed report for this exact stage - identical checks to
  -- apply_grandtour_official_stage_result, since a correction is no less
  -- risky than a first import.
  if p_reconciliation is null or jsonb_typeof(p_reconciliation) <> 'object' then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_reconciliation must be a JSON object (the reconcileStageResult() output for this stage).';
  end if;

  if coalesce((p_reconciliation->>'stageNumber')::int, -1) <> v_stage.stage_number then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_reconciliation.stageNumber (%) does not match stage_id % (stage_number %).',
      p_reconciliation->>'stageNumber', p_stage_id, v_stage.stage_number;
  end if;

  if coalesce((p_reconciliation->>'isTtt')::boolean, true) is distinct from false then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_reconciliation.isTtt must be false.';
  end if;

  if coalesce((p_reconciliation->>'missingStageRecord')::boolean, true) is distinct from false then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_reconciliation.missingStageRecord must be false.';
  end if;

  if coalesce((p_reconciliation->>'startlistValidationPassed')::boolean, false) is distinct from true then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_reconciliation.startlistValidationPassed must be true.';
  end if;

  if jsonb_array_length(coalesce(p_reconciliation->'unmatchedRiders', '[]'::jsonb)) <> 0 then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_reconciliation.unmatchedRiders must be empty.';
  end if;

  if jsonb_array_length(coalesce(p_reconciliation->'ambiguousRiders', '[]'::jsonb)) <> 0 then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_reconciliation.ambiguousRiders must be empty.';
  end if;

  if jsonb_array_length(coalesce(p_reconciliation->'unmatchedTeams', '[]'::jsonb)) <> 0 then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_reconciliation.unmatchedTeams must be empty.';
  end if;

  if jsonb_array_length(coalesce(p_reconciliation->'ambiguousTeams', '[]'::jsonb)) <> 0 then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_reconciliation.ambiguousTeams must be empty.';
  end if;

  if jsonb_array_length(coalesce(p_reconciliation->'duplicateBibConflicts', '[]'::jsonb)) <> 0 then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_reconciliation.duplicateBibConflicts must be empty.';
  end if;

  if coalesce((p_reconciliation->>'safeToApply')::boolean, false) is distinct from true then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_reconciliation.safeToApply must be true.';
  end if;

  -- Gate 5: exactly 10 result lines, no duplicates, every rider_id vouched
  -- for by p_reconciliation.matchedRiders.
  if p_result_lines is null or jsonb_typeof(p_result_lines) <> 'array' then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_result_lines must be a JSON array of {"rider_id": uuid, "actual_position": int}.';
  end if;

  if jsonb_array_length(p_result_lines) <> 10 then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_result_lines must contain exactly 10 rows for a non-TTT stage correction (got %).', jsonb_array_length(p_result_lines);
  end if;

  if (select count(distinct elem->>'rider_id') from jsonb_array_elements(p_result_lines) elem) <> 10 then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_result_lines contains duplicate rider_id values.';
  end if;

  if (select count(distinct (elem->>'actual_position')) from jsonb_array_elements(p_result_lines) elem) <> 10 then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_result_lines contains duplicate actual_position values.';
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
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_result_lines contains a rider_id not present in p_reconciliation.matchedRiders.';
  end if;

  -- Gate 6: exactly 4 jersey holders, one per type, every rider_id vouched
  -- for by a matched entry in p_reconciliation.jerseyHolders.
  if p_jersey_holders is null or jsonb_typeof(p_jersey_holders) <> 'array' then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_jersey_holders must be a JSON array of {"jersey_type": text, "rider_id": uuid}.';
  end if;

  if jsonb_array_length(p_jersey_holders) <> 4 then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_jersey_holders must contain exactly 4 entries for a non-TTT stage correction (got %).', jsonb_array_length(p_jersey_holders);
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_jersey_holders) elem
    where elem->>'jersey_type' not in ('yellow', 'green', 'kom', 'white')
  ) then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_jersey_holders contains an invalid jersey_type; must be one of yellow, green, kom, white.';
  end if;

  if (select count(distinct elem->>'jersey_type') from jsonb_array_elements(p_jersey_holders) elem) <> 4 then
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_jersey_holders must contain exactly one entry per jersey_type (yellow, green, kom, white), no duplicates.';
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
    raise exception 'correct_grandtour_stage_result_from_reviewed_report: p_jersey_holders contains a jersey_type/rider_id not present as a matched entry in p_reconciliation.jerseyHolders.';
  end if;

  -- Normalize incoming vs existing for a byte-for-byte no_change comparison.
  select jsonb_agg(jsonb_build_object('rider_id', elem->>'rider_id', 'actual_position', (elem->>'actual_position')::int) order by (elem->>'actual_position')::int)
  into v_incoming_lines
  from jsonb_array_elements(p_result_lines) elem;

  select jsonb_agg(jsonb_build_object('jersey_type', elem->>'jersey_type', 'rider_id', elem->>'rider_id') order by elem->>'jersey_type')
  into v_incoming_jerseys
  from jsonb_array_elements(p_jersey_holders) elem;

  select jsonb_agg(jsonb_build_object('rider_id', lines.rider_id::text, 'actual_position', lines.actual_position) order by lines.actual_position)
  into v_existing_lines
  from public.grandtour_stage_result_lines lines
  where lines.stage_result_id = v_result.id;

  select jsonb_agg(jsonb_build_object('jersey_type', holders.jersey_type::text, 'rider_id', holders.rider_id::text) order by holders.jersey_type::text)
  into v_existing_jerseys
  from public.grandtour_stage_jersey_holders holders
  where holders.stage_id = p_stage_id;

  -- Idempotent no-op: identical content, nothing to correct. Touches
  -- nothing (no review-status reset, no score clearing, no audit row) -
  -- matches apply_grandtour_official_stage_result's own no_change
  -- convention of never duplicating writes for an unchanged reapply.
  if coalesce(v_existing_lines, '[]'::jsonb) = coalesce(v_incoming_lines, '[]'::jsonb)
     and coalesce(v_existing_jerseys, '[]'::jsonb) = coalesce(v_incoming_jerseys, '[]'::jsonb) then
    return jsonb_build_object(
      'status', 'no_change',
      'stage_id', p_stage_id,
      'stage_result_id', v_result.id,
      'line_count', jsonb_array_length(coalesce(v_existing_lines, '[]'::jsonb)),
      'jersey_holder_count', jsonb_array_length(coalesce(v_existing_jerseys, '[]'::jsonb)),
      'review_status', v_result.review_status,
      'is_final', v_result.is_final,
      'scores_cleared', 0
    );
  end if;

  select count(*) into v_before_score_count from public.grandtour_stage_scores where stage_id = p_stage_id;
  v_was_finalised := v_result.is_final;

  v_before_payload := jsonb_build_object(
    'result_lines', coalesce(v_existing_lines, '[]'::jsonb),
    'jersey_holders', coalesce(v_existing_jerseys, '[]'::jsonb),
    'review_status', v_result.review_status,
    'is_final', v_result.is_final,
    'score_count', v_before_score_count
  );

  -- Unfinalise FIRST (see the trigger-ordering note above) - required
  -- before any line/jersey-holder delete can succeed if the stage was
  -- finalised. Always lands on review_status='correction_required' and
  -- is_final=false, regardless of the prior state (draft/imported/
  -- admin_checked/finalised) - requirement #14: the admin must always
  -- re-check, re-finalise, and re-score after any real correction, never
  -- skip straight back to admin_checked or finalised.
  update public.grandtour_stage_results
  set review_status = 'correction_required',
      is_final = false,
      finalised_at = null,
      finalised_by = null,
      finalisation_reason = null
  where id = v_result.id;

  -- Clear stale scores, if any. Tips that were 'scored' move to
  -- 'corrected' (grandtour_tip_status already has this value and
  -- public.recalculate_grandtour_stage_scores already special-cases it -
  -- see 20260703041335_implement_grandtour_ttt_scoring.sql - keeping a
  -- rescored tip's status as 'corrected' rather than reverting it to
  -- 'scored'). The score rows themselves are deleted rather than left
  -- stale in place, because finalize_grandtour_stage_result's own
  -- pre-existing gate refuses to finalize a stage that already has score
  -- rows - leaving stale rows behind would silently block the "re-check,
  -- re-finalise, re-score" path this function's own contract requires.
  if v_before_score_count > 0 then
    update public.grandtour_tips
    set status = 'corrected'
    where status = 'scored'
      and id in (select tip_id from public.grandtour_stage_scores where stage_id = p_stage_id);

    delete from public.grandtour_stage_scores where stage_id = p_stage_id;
    get diagnostics v_scores_cleared = row_count;
  end if;

  delete from public.grandtour_stage_result_lines where stage_result_id = v_result.id;
  for v_line in select * from jsonb_array_elements(p_result_lines)
  loop
    insert into public.grandtour_stage_result_lines (stage_result_id, rider_id, actual_position)
    values (v_result.id, (v_line->>'rider_id')::uuid, (v_line->>'actual_position')::int);
  end loop;

  delete from public.grandtour_stage_jersey_holders where stage_id = p_stage_id;
  for v_line in select * from jsonb_array_elements(p_jersey_holders)
  loop
    insert into public.grandtour_stage_jersey_holders (stage_id, jersey_type, rider_id)
    values (p_stage_id, (v_line->>'jersey_type')::public.grandtour_jersey_type, (v_line->>'rider_id')::uuid);
  end loop;

  v_after_payload := jsonb_build_object(
    'result_lines', v_incoming_lines,
    'jersey_holders', v_incoming_jerseys,
    'review_status', 'correction_required',
    'is_final', false,
    'score_count', 0,
    'scores_cleared', v_scores_cleared,
    'request_id', p_request_id
  );

  insert into public.grandtour_result_audit_log (
    stage_id, stage_result_id, action, changed_by, reason, before_payload, after_payload
  ) values (
    p_stage_id, v_result.id, 'result_corrected', (select auth.uid()), p_reason, v_before_payload, v_after_payload
  );

  return jsonb_build_object(
    'status', 'corrected',
    'stage_id', p_stage_id,
    'stage_result_id', v_result.id,
    'line_count', 10,
    'jersey_holder_count', 4,
    'review_status', 'correction_required',
    'is_final', false,
    'was_finalised', v_was_finalised,
    'scores_cleared', v_scores_cleared
  );
end;
$$;

comment on function public.correct_grandtour_stage_result_from_reviewed_report(uuid, jsonb, jsonb, jsonb, text, text) is
  'Corrects an EXISTING GrandTour stage result (draft or already finalised) from a freshly reviewed reconciliation report: replaces the top-10 result lines and 4 jersey holders, resets review_status to correction_required and is_final to false (unfinalising if needed), and clears any stale scores (deletes grandtour_stage_scores rows for the stage, moves affected tips from scored to corrected). Never finalises or scores. Requires a non-blank p_reason. Idempotent no-op (status=no_change) when the incoming content is byte-identical to what is already stored. Logs one result_corrected row to grandtour_result_audit_log on a genuine correction (never on no_change). Requires grandtour_private.is_cycling_admin() internally; callable by service_role (CLI) or an authenticated cycling admin''s own session (admin UI).';

revoke all on function public.correct_grandtour_stage_result_from_reviewed_report(uuid, jsonb, jsonb, jsonb, text, text)
from public, anon, authenticated;

grant execute on function public.correct_grandtour_stage_result_from_reviewed_report(uuid, jsonb, jsonb, jsonb, text, text)
to service_role, authenticated;

-- grandtour_result_audit_log's action vocabulary needs 'result_corrected'
-- added (distinct from the pre-existing, unrelated 'result_corrected'
-- action already used by the GENERIC grandtour_game_audit trigger-based
-- trail - grandtour_result_audit_log is a separate table with its own
-- action vocabulary; both tables happening to use the same action name for
-- a correction is intentional, not a collision, since they serve different
-- purposes and are never queried together).
alter table public.grandtour_result_audit_log
  drop constraint grandtour_result_audit_log_action_check;

alter table public.grandtour_result_audit_log
  add constraint grandtour_result_audit_log_action_check
  check (action in (
    'official_import_applied',
    'manual_result_created',
    'manual_result_updated',
    'jersey_holder_updated',
    'admin_checked',
    'finalised',
    'unfinalised',
    'scored',
    'result_corrected'
  ));
