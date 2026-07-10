-- Two fixes to public.grandtour_result_audit_log
-- (20260710020000_grandtour_stage_result_review_workflow_schema.sql),
-- found while smoke-testing the admin review workflow end to end:
--
-- 1. service_role was never granted SELECT on this table. The RPCs that
--    write to it run security definer (as the migration owner), so they
--    never needed a grant to INSERT — but any service-role-authenticated
--    client (e.g. an operator script) reading it back directly, the way
--    scripts/grandtour-apply-local-smoke.mjs does, hit "permission denied
--    for table grandtour_result_audit_log". service_role should have at
--    least the same read access as authenticated (which is RLS-gated to
--    cycling admins) — service_role bypasses RLS but still requires an
--    explicit table-level grant.
--
-- 2. The append-only trigger was too strict: it blocked the FK's own
--    `stage_result_id ... on delete set null` action when a
--    grandtour_stage_results row is deleted (that FK action performs an
--    UPDATE on the referencing grandtour_result_audit_log row, which the
--    trigger unconditionally rejected). This broke the documented
--    rollback path in
--    docs/GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md §11
--    (`delete from public.grandtour_stage_results where id = ...`) for
--    any draft that already has an audit trail — which is every draft,
--    since apply_grandtour_official_stage_result already writes an
--    'official_import_applied' row on the very first apply. The trigger
--    now allows exactly that one FK-driven "null out stage_result_id,
--    change nothing else" update, and continues to reject every other
--    update and all deletes.

grant select on table public.grandtour_result_audit_log to service_role;

create or replace function grandtour_private.prevent_result_audit_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'public.grandtour_result_audit_log is append-only and cannot be deleted.';
  end if;

  -- Allow exactly the grandtour_stage_results ON DELETE SET NULL FK action
  -- (stage_result_id -> null, nothing else changed); reject every other
  -- update.
  if new.stage_result_id is null
    and new.id = old.id
    and new.stage_id = old.stage_id
    and new.action = old.action
    and new.changed_by is not distinct from old.changed_by
    and new.reason is not distinct from old.reason
    and new.before_payload is not distinct from old.before_payload
    and new.after_payload is not distinct from old.after_payload
    and new.created_at = old.created_at
  then
    return new;
  end if;

  raise exception 'public.grandtour_result_audit_log is append-only and cannot be updated.';
end;
$$;
