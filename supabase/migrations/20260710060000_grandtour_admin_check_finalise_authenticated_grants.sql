-- Allow the GrandTour admin-check and finalise RPCs to be called directly
-- from an authenticated admin's own Supabase session (the Vercel-safe
-- frontend path, apps/mobile/app/admin/grandtour-stages.tsx), not only via
-- the service-role CLI/SQL path used so far
-- (scripts/grandtour-admin-stage.mjs --mark-checked/--finalise).
--
-- Both public.mark_grandtour_stage_result_checked(...) and
-- public.finalize_grandtour_stage_result(...) are `security definer` and,
-- until now, EXECUTE-granted only to service_role, trusting the
-- caller-supplied p_checked_by/p_finalized_by blindly with no internal
-- permission check of their own - safe only because the only holders of
-- the service-role key were trusted operators. Granting EXECUTE to
-- `authenticated` without an internal check would let ANY signed-in user
-- mark-check or finalise any stage, since `security definer` runs with the
-- owning role's privileges regardless of who calls it.
--
-- Fix: add a guard as the first thing each function does - `auth.role() =
-- 'service_role' or grandtour_private.is_cycling_admin()` - then grant
-- EXECUTE to `authenticated` alongside the existing service_role grant.
-- The explicit `auth.role() = 'service_role'` bypass is required, not
-- incidental: auth.role()/auth.uid() read from PostgREST's JWT-claim GUCs
-- (unaffected by `security definer`'s role-switching), and a genuine
-- service-role JWT carries no real end-user `sub` claim tied to a
-- user_app_memberships row, so grandtour_private.is_cycling_admin() alone
-- would (correctly, but unhelpfully) evaluate false for service_role too -
-- without the explicit bypass, this migration would silently break the
-- existing CLI path (scripts/grandtour-admin-stage.mjs
-- --mark-checked/--finalise), which authenticates purely via the
-- service-role key and sets no JWT claims of its own. This intentionally
-- mirrors every other service_role-only RPC in this pipeline (apply,
-- etc.), which have always trusted the GRANT alone with no internal
-- identity check - service_role is the DB's own "trusted operator" role,
-- unlike `authenticated`, which now also needs the explicit admin check.
-- public.recalculate_grandtour_stage_scores deliberately gets NO such
-- bypass - it has always required a genuine authenticated cycling-admin
-- session, never service_role, and that stays true here.
--
-- Both signatures are byte-identical to the versions created in
-- 20260710030000_grandtour_admin_review_workflow_rpc.sql
-- (mark_grandtour_stage_result_checked(uuid, uuid, text, text),
-- finalize_grandtour_stage_result(uuid, uuid, text, text)) - only the
-- function body gains one new guard clause each, so `create or replace
-- function` is a safe same-OID replace here (see CLAUDE.md's Postgres
-- gotcha note: a parameter-list change would require an explicit drop
-- first; nothing about the parameter list changes in this migration).
--
-- PRE-EXISTING BUG FOUND AND FIXED HERE (discovered while writing this
-- migration's own negative tests - see
-- supabase/tests/grandtour_finalize_stage_result.sql tests 14-16):
-- grandtour_private.is_cycling_admin() (20260701081334_canonical_grandtour_tipping_rpcs_rls.sql)
-- was written as `select <bool expr> from (...) x where exists (...)`.
-- When the `where exists (...)` is false, that query returns ZERO ROWS,
-- and a scalar-context call to a zero-row `returns boolean` SQL function
-- evaluates to NULL, not false. Every `if not grandtour_private.is_cycling_admin() then raise exception ...`
-- guard (including this migration's own two new call sites, and the
-- PRE-EXISTING one in public.recalculate_grandtour_stage_scores) is
-- therefore silently a no-op for non-admins: `if not NULL` is NULL, and
-- PL/pgSQL's `if` only takes the branch when the condition is TRUE, so the
-- exception never fires and execution just continues as if the caller
-- were an admin. Confirmed empirically: before this fix, a genuinely
-- non-admin authenticated session could call
-- recalculate_grandtour_stage_scores() and proceed straight past the
-- admin check to the next validation step.
--
-- This does NOT affect any `using (grandtour_private.is_cycling_admin())`
-- / `with check (...)` RLS policy elsewhere in the schema - Postgres RLS
-- treats a NULL boolean the same as false (the row is excluded either
-- way), so every existing RLS usage of this function was already safe.
-- Only the imperative `if not is_cycling_admin() then raise` pattern was
-- exposed, and only `recalculate_grandtour_stage_scores` used that
-- pattern before this migration.
--
-- Fix: rewrite the function body as `select exists (...)`, which always
-- returns exactly one row with a genuine true/false, never NULL - same
-- signature (`()  returns boolean`), so `create or replace` is a safe
-- same-OID replace here too.
create or replace function grandtour_private.is_cycling_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_app_memberships membership
    join public.apps app on app.id = membership.app_id
    where membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role = 'admin'
      and app.code = 'cycling'
      and app.is_active
  );
$$;

comment on function grandtour_private.is_cycling_admin() is
  'Whether the current session (auth.uid()) is an active admin on the cycling app. Always returns a genuine true/false via select exists(...) - never NULL - so `if not is_cycling_admin() then raise exception` guards actually fire for non-admins. (A prior `where exists(...)`-filtered-row version returned NULL instead of false for non-admins, silently disabling every such guard; fixed in 20260710060000_grandtour_admin_check_finalise_authenticated_grants.sql.)';

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
  v_result record;
  v_line_count int;
  v_jersey_count int;
begin
  if auth.role() <> 'service_role' and not grandtour_private.is_cycling_admin() then
    raise exception 'mark_grandtour_stage_result_checked: GrandTour administrator access is required.';
  end if;

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
  'Records an admin review of a draft/imported GrandTour stage result (review_status -> admin_checked) after confirming exactly 10 result lines and 4 jersey holders exist for a non-TTT stage. Never scores, never finalizes. Logs to public.grandtour_result_audit_log. Requires grandtour_private.is_cycling_admin() internally; callable by service_role (CLI) or by an authenticated cycling admin''s own session (admin UI) - never by anon or a non-admin authenticated user.';

grant execute on function public.mark_grandtour_stage_result_checked(uuid, uuid, text, text)
to authenticated;

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
  v_result record;
  v_line_count int;
  v_jersey_count int;
  v_score_count int;
begin
  if auth.role() <> 'service_role' and not grandtour_private.is_cycling_admin() then
    raise exception 'finalize_grandtour_stage_result: GrandTour administrator access is required.';
  end if;

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
  'Finalizes a GrandTour stage draft result (is_final -> true, review_status -> finalised) for a non-TTT stage, after confirming review_status=admin_checked, exactly 10 result lines, exactly 4 jersey holders, and no pre-existing score rows. Never modifies result lines or jersey holders, never scores, never touches TTT stages. Logs to public.grandtour_result_audit_log. Requires grandtour_private.is_cycling_admin() internally; callable by service_role (CLI) or by an authenticated cycling admin''s own session (admin UI) - never by anon or a non-admin authenticated user.';

grant execute on function public.finalize_grandtour_stage_result(uuid, uuid, text, text)
to authenticated;
