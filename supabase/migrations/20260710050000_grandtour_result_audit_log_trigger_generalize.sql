-- Further generalizes grandtour_private.prevent_result_audit_log_change()
-- (20260710040000_grandtour_result_audit_log_fixes.sql fixed the
-- stage_result_id -> null FK case; this migration also allows the
-- changed_by -> null FK case, discovered when deleting a test auth.users
-- row whose id was referenced by changed_by triggered the same
-- "append-only" rejection). Generalized to: any UPDATE that only turns
-- currently-non-null FK columns (stage_result_id, changed_by) into null,
-- with every other column unchanged, is allowed (these are exactly the two
-- ON DELETE SET NULL foreign keys grandtour_result_audit_log has); every
-- other update, and all deletes, remain rejected.
create or replace function grandtour_private.prevent_result_audit_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'public.grandtour_result_audit_log is append-only and cannot be deleted.';
  end if;

  if (new.stage_result_id is null or new.stage_result_id = old.stage_result_id)
    and (new.changed_by is null or new.changed_by = old.changed_by)
    and new.id = old.id
    and new.stage_id = old.stage_id
    and new.action = old.action
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
