-- Adds public.finalize_grandtour_stage_result(...), a service_role-only
-- RPC that transitions a GrandTour stage's draft result
-- (grandtour_stage_results.is_final: false -> true) after confirming it is
-- eligible to be scored. This closes the gap discovered when
-- public.recalculate_grandtour_stage_scores() correctly refused with
-- "Scoring requires a final stage result": no path existed to finalize a
-- result once apply mode (20260709020000/20260709070000) had written it as
-- a draft, since apply_grandtour_official_stage_result() always hard-refuses
-- p_finalize=true and no separate finalize RPC existed.
--
-- Scope, deliberately narrow:
--   - Only ever sets grandtour_stage_results.is_final = true. Never inserts,
--     updates, or deletes grandtour_stage_result_lines or
--     grandtour_stage_jersey_holders.
--   - Never calls recalculate_grandtour_stage_scores() or writes to
--     grandtour_stage_scores. Scoring remains a fully separate, explicit
--     step the operator runs after finalizing (see
--     docs/GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md's
--     dry-run -> apply -> verify -> finalize -> score -> verify workflow).
--   - Refuses TTT stages outright (stage_type in ('team_time_trial','ttt'))
--     — no TTT finalization path exists yet, matching
--     apply_grandtour_official_stage_result()'s own TTT refusal.
--   - Refuses unless the stage has no grandtour_stage_results row (must
--     apply first), a FINAL result already (returns "no_change", matching
--     the idempotency convention apply_grandtour_official_stage_result()
--     already established rather than raising), exactly 10 result lines,
--     exactly 4 jersey holders, or already has score rows (a state that
--     should be unreachable in practice since scoring itself requires
--     is_final=true, but is refused defensively rather than silently
--     finalizing over it).
--
-- These checks are deliberately stricter (exactly 10, not "5 or 10") than
-- grandtour_private.validate_final_result() (20260703041335_implement_grandtour_ttt_scoring.sql),
-- the existing BEFORE INSERT OR UPDATE trigger on grandtour_stage_results
-- that independently re-validates line/jersey counts whenever is_final
-- transitions to true and accepts 5 or 10 lines for backward generality.
-- This RPC's own exactly-10 check matches the v1 top-10-only apply policy
-- (docs/grandtour-apply-mode-spec.md §14.1/§16.1) and runs BEFORE the
-- UPDATE, so a caller gets this RPC's specific, actionable error message
-- rather than the trigger's more generic one; the trigger remains as
-- defense-in-depth underneath it, exactly like apply mode's own layering.
--
-- Audit trail: no new table is needed. grandtour_stage_results already has
-- an AFTER trigger (grandtour_stage_results_audit ->
-- grandtour_private.audit_result_mutation(), 20260701081334_canonical_grandtour_tipping_rpcs_rls.sql)
-- that automatically inserts a public.grandtour_game_audit row with
-- action='result_finalised' whenever is_final transitions to true, reading
-- p_reason/p_request_id from the same grandtour.audit_reason/grandtour.request_id
-- session settings the rest of this schema's admin RPCs already use. This
-- RPC only needs to set those two session variables before the UPDATE.
create function public.finalize_grandtour_stage_result(
  p_stage_id uuid,
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
  v_is_final boolean;
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

  select results.id, results.is_final
  into v_result_id, v_is_final
  from public.grandtour_stage_results results
  where results.stage_id = p_stage_id;

  if v_result_id is null then
    raise exception 'finalize_grandtour_stage_result: stage % has no draft result; apply the official result first.', p_stage_id;
  end if;

  if v_is_final then
    return jsonb_build_object(
      'status', 'no_change',
      'stage_id', p_stage_id,
      'stage_result_id', v_result_id,
      'is_final', true
    );
  end if;

  select count(*) into v_line_count
  from public.grandtour_stage_result_lines lines
  where lines.stage_result_id = v_result_id;

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
  set is_final = true
  where id = v_result_id;

  return jsonb_build_object(
    'status', 'finalized',
    'stage_id', p_stage_id,
    'stage_result_id', v_result_id,
    'is_final', true
  );
end;
$$;

comment on function public.finalize_grandtour_stage_result(uuid, text, text) is
  'Finalizes a GrandTour stage draft result (sets grandtour_stage_results.is_final = true) for a non-TTT stage, after confirming exactly 10 result lines and 4 jersey holders exist and no score rows already exist. Never modifies result lines or jersey holders, never scores, never touches TTT stages. service_role only.';

revoke all on function public.finalize_grandtour_stage_result(uuid, text, text)
from public, anon, authenticated;

grant execute on function public.finalize_grandtour_stage_result(uuid, text, text)
to service_role;
