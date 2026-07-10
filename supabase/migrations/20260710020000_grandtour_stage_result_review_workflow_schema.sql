-- Schema foundation for the admin result-review workflow: draft/imported ->
-- admin_checked -> finalised, with an explicit manual-entry gate and a
-- dedicated audit log for every admin/manual action on a stage result.
-- See docs/GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md's
-- "Admin review and finalization workflow" section for the full operator
-- sequence this supports.

create type public.grandtour_stage_result_review_status as enum (
  'draft',
  'imported',
  'review_required',
  'admin_checked',
  'finalised',
  'correction_required'
);

create type public.grandtour_stage_result_source_mode as enum (
  'official_feed',
  'manual_admin',
  'mixed',
  'test'
);

alter table public.grandtour_stage_results
  add column if not exists review_status public.grandtour_stage_result_review_status not null default 'draft',
  add column if not exists admin_checked_at timestamptz,
  add column if not exists admin_checked_by uuid references auth.users(id) on delete set null,
  add column if not exists admin_check_note text,
  add column if not exists finalised_at timestamptz,
  add column if not exists finalised_by uuid references auth.users(id) on delete set null,
  add column if not exists finalisation_reason text,
  add column if not exists source_mode public.grandtour_stage_result_source_mode not null default 'official_feed';

-- A finalised row must always carry review_status='finalised' and vice
-- versa (kept consistent by finalize_grandtour_stage_result, but enforced
-- at the schema level too so a direct/manual UPDATE can't create a
-- contradictory state without a data-integrity error).
alter table public.grandtour_stage_results
  add constraint grandtour_stage_results_final_review_status_check
  check (is_final = (review_status = 'finalised'));

-- Admins can enable manual result entry per grand tour (e.g. when the
-- official feed fails for a stage, a day is skipped, or for testing). Off
-- by default: manual entry must be a deliberate, visible admin decision,
-- never an implicit fallback.
alter table public.grand_tours
  add column if not exists manual_result_entry_enabled boolean not null default false;

-- Dedicated audit trail for the admin review/finalization workflow and any
-- manual result/jersey-holder entry, distinct from the pre-existing generic
-- public.grandtour_game_audit (which already auto-logs every raw
-- grandtour_stage_results/*_lines/*_jersey_holders mutation via triggers
-- for a different purpose — a full before/after row-level trail). This
-- table instead captures one row per *workflow action*, with an action
-- vocabulary specific to this feature, written explicitly by the RPCs
-- below rather than by a generic mutation trigger.
create table public.grandtour_result_audit_log (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.grandtour_stages(id) on delete cascade,
  stage_result_id uuid references public.grandtour_stage_results(id) on delete set null,
  action text not null,
  changed_by uuid references auth.users(id) on delete set null,
  reason text,
  before_payload jsonb,
  after_payload jsonb,
  created_at timestamptz not null default now(),
  check (action in (
    'official_import_applied',
    'manual_result_created',
    'manual_result_updated',
    'jersey_holder_updated',
    'admin_checked',
    'finalised',
    'unfinalised',
    'scored'
  ))
);

create index grandtour_result_audit_log_stage_id_idx
on public.grandtour_result_audit_log (stage_id, created_at desc);

alter table public.grandtour_result_audit_log enable row level security;

-- Append-only, mirroring grandtour_game_audit_append_only's convention:
-- this is an audit trail, not an editable record.
create function grandtour_private.prevent_result_audit_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'public.grandtour_result_audit_log is append-only and cannot be updated or deleted.';
end;
$$;

create trigger grandtour_result_audit_log_append_only
before update or delete on public.grandtour_result_audit_log
for each row execute function grandtour_private.prevent_result_audit_log_change();

-- Read: cycling admins only (matches grandtour_game_audit's admin-facing
-- read policy). Write: only the security-definer RPCs below insert into
-- this table (running with their owning role's privileges, not the
-- caller's grants), so no INSERT grant is issued to any client-facing role.
create policy "Cycling admins can view GrandTour result audit log"
on public.grandtour_result_audit_log for select
to authenticated
using (grandtour_private.is_cycling_admin());

revoke all on table public.grandtour_result_audit_log from public, anon, authenticated;
grant select on table public.grandtour_result_audit_log to authenticated;

-- Optional per spec: lets an admin flip manual_result_entry_enabled for a
-- grand tour, service_role-only, logged to the existing general-purpose
-- public.grandtour_game_audit (action='admin_override') rather than the
-- stage-scoped grandtour_result_audit_log above, since this is a
-- tour-level setting change with no stage_id (grandtour_result_audit_log's
-- stage_id is NOT NULL by design, and 'manual_result_entry_enabled' is not
-- part of that table's action vocabulary above).
create function public.set_grandtour_manual_result_entry_enabled(
  p_grand_tour_id uuid,
  p_enabled boolean,
  p_changed_by uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before boolean;
begin
  select manual_result_entry_enabled into v_before
  from public.grand_tours
  where id = p_grand_tour_id;

  if not found then
    raise exception 'set_grandtour_manual_result_entry_enabled: no grand_tours row found for grand_tour_id %.', p_grand_tour_id;
  end if;

  update public.grand_tours
  set manual_result_entry_enabled = p_enabled
  where id = p_grand_tour_id;

  insert into public.grandtour_game_audit (
    actor_user_id, action, entity_type, entity_id, old_value, new_value, reason
  ) values (
    p_changed_by,
    'admin_override',
    'grand_tours',
    p_grand_tour_id,
    jsonb_build_object('manual_result_entry_enabled', v_before),
    jsonb_build_object('manual_result_entry_enabled', p_enabled),
    p_reason
  );

  return jsonb_build_object(
    'status', 'updated',
    'grand_tour_id', p_grand_tour_id,
    'manual_result_entry_enabled', p_enabled
  );
end;
$$;

comment on function public.set_grandtour_manual_result_entry_enabled(uuid, boolean, uuid, text) is
  'Enables/disables manual result entry for a grand tour (public.grand_tours.manual_result_entry_enabled). Off by default. Logs to public.grandtour_game_audit. service_role only.';

revoke all on function public.set_grandtour_manual_result_entry_enabled(uuid, boolean, uuid, text)
from public, anon, authenticated;

grant execute on function public.set_grandtour_manual_result_entry_enabled(uuid, boolean, uuid, text)
to service_role;
