-- Review queue and sync-run audit trail for the master UCI rider
-- registry (public.uci_riders et al, 20260717020000/20260717030000). See
-- CLAUDE.md's "Master UCI Rider Registry & Weekly Sync" section.
--
-- Both new tables follow the same admin-read/service-write RLS shape
-- already used by public.grandtour_feed_import_runs/grandtour_feed_snapshots
-- (20260629080958_grandtour_mvp.sql, granted to authenticated in
-- 20260717010000): select restricted to grandtour_private.is_cycling_admin(),
-- writes service_role-only except via the RPC below.

create type public.uci_rider_review_queue_type as enum (
  'unmatched_startlist_rider',
  'ambiguous_candidate',
  'dob_conflict',
  'nationality_conflict',
  'team_mismatch',
  'duplicate_uci_identity',
  'suspected_duplicate_internal_rider',
  'low_confidence_alias_match'
);

create type public.uci_rider_review_queue_status as enum (
  'pending',
  'matched',
  'new_rider_approved',
  'source_correction',
  'ignored',
  'resolved'
);

create table public.uci_rider_review_queue (
  id uuid primary key default gen_random_uuid(),
  queue_type public.uci_rider_review_queue_type not null,
  status public.uci_rider_review_queue_status not null default 'pending',
  rider_id uuid references public.uci_riders(id) on delete set null,
  grandtour_rider_id uuid references public.grandtour_riders(id) on delete set null,
  candidate_payload jsonb not null default '{}'::jsonb,
  reason text,
  source text not null default 'uci_sync',
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.uci_rider_review_queue is
  'Anything scripts/uci-rider-sync.mjs (or scripts/race-entry-rider-matching.mjs, via a race-specific matching run) could not resolve automatically -- an ambiguous UCI candidate, a DOB/nationality conflict, a team mismatch, a suspected duplicate identity, or an unmatched startlist rider. Never silently dropped; every such case gets a row here. Resolved via public.resolve_uci_rider_review_item(), below.';

create index uci_rider_review_queue_status_idx on public.uci_rider_review_queue (status, created_at desc);
create index uci_rider_review_queue_rider_id_idx on public.uci_rider_review_queue (rider_id);

alter table public.uci_rider_review_queue enable row level security;

create policy "Cycling admins can view the UCI rider review queue"
on public.uci_rider_review_queue for select
to authenticated
using (grandtour_private.is_cycling_admin());

revoke all on table public.uci_rider_review_queue from public, anon, authenticated;
grant select on table public.uci_rider_review_queue to authenticated;
grant select, insert, update, delete on table public.uci_rider_review_queue to service_role;

create trigger uci_rider_review_queue_set_updated_at
before update on public.uci_rider_review_queue
for each row execute function app_private.set_updated_at();

create type public.uci_rider_sync_run_status as enum (
  'running',
  'completed',
  'failed',
  'partial'
);

create type public.uci_rider_sync_run_mode as enum (
  'dry_run',
  'apply'
);

create table public.uci_rider_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'uci',
  discipline text not null,
  season_year integer not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  pages_requested integer not null default 0,
  records_received integer not null default 0,
  unique_riders_received integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  conflicts_count integer not null default 0,
  review_items_count integer not null default 0,
  failed_records_count integer not null default 0,
  circuit_breaker_activations integer not null default 0,
  status public.uci_rider_sync_run_status not null default 'running',
  mode public.uci_rider_sync_run_mode not null,
  source_summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

comment on table public.uci_rider_sync_runs is
  'One row per scripts/uci-rider-sync.mjs invocation -- audit trail for the weekly UCI registry sync, mirroring grandtour_feed_import_runs'' role for the official-letour results pipeline. status/mode are always set explicitly (never left at a misleadingly-partial default) by the CLI, even on a mid-run failure.';

create index uci_rider_sync_runs_started_at_idx on public.uci_rider_sync_runs (started_at desc);

alter table public.uci_rider_sync_runs enable row level security;

create policy "Cycling admins can view UCI rider sync runs"
on public.uci_rider_sync_runs for select
to authenticated
using (grandtour_private.is_cycling_admin());

revoke all on table public.uci_rider_sync_runs from public, anon, authenticated;
grant select on table public.uci_rider_sync_runs to authenticated;
grant select, insert, update, delete on table public.uci_rider_sync_runs to service_role;

-- Resolves one review-queue item. Same service_role-or-cycling-admin
-- guard pattern as mark_grandtour_stage_result_checked/
-- finalize_grandtour_stage_result (20260710060000): auth.role() =
-- 'service_role' bypasses the admin check (the CLI, scripts/uci-rider-review.mjs,
-- authenticates purely via the service-role key and sets no JWT claims of
-- its own -- grandtour_private.is_cycling_admin() would otherwise
-- correctly, but unhelpfully, evaluate false for it too).
--
-- When p_create_alias is supplied ({rider_id, alias_text, alias_type}),
-- also inserts into public.uci_rider_aliases in the same call -- this is
-- the "approved race-name alias becomes reusable" requirement: an admin
-- reviewing a low-confidence race-entry match can approve it and, in one
-- step, teach the registry that alias for next time.
create function public.resolve_uci_rider_review_item(
  p_item_id uuid,
  p_status public.uci_rider_review_queue_status,
  p_resolved_by uuid,
  p_note text default null,
  p_create_alias jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_alias_rider_id uuid;
  v_alias_text text;
  v_alias_type public.uci_rider_alias_type;
  v_alias_id uuid;
begin
  if auth.role() <> 'service_role' and not grandtour_private.is_cycling_admin() then
    raise exception 'resolve_uci_rider_review_item: GrandTour administrator access is required.';
  end if;

  select id, status into v_item
  from public.uci_rider_review_queue
  where id = p_item_id;

  if v_item.id is null then
    raise exception 'resolve_uci_rider_review_item: no uci_rider_review_queue row found for id %.', p_item_id;
  end if;

  if p_status = 'pending' then
    raise exception 'resolve_uci_rider_review_item: p_status cannot be set back to pending via this function.';
  end if;

  update public.uci_rider_review_queue
  set status = p_status,
      resolved_by = p_resolved_by,
      resolved_at = now(),
      resolution_note = p_note
  where id = p_item_id;

  v_alias_id := null;
  if p_create_alias is not null then
    v_alias_rider_id := (p_create_alias ->> 'rider_id')::uuid;
    v_alias_text := p_create_alias ->> 'alias_text';
    v_alias_type := (p_create_alias ->> 'alias_type')::public.uci_rider_alias_type;

    if v_alias_rider_id is null or v_alias_text is null or v_alias_type is null then
      raise exception 'resolve_uci_rider_review_item: p_create_alias requires rider_id, alias_text, and alias_type.';
    end if;

    insert into public.uci_rider_aliases (rider_id, alias_text, normalized_alias, alias_type, source, confidence)
    values (
      v_alias_rider_id,
      v_alias_text,
      lower(regexp_replace(trim(v_alias_text), '\s+', ' ', 'g')),
      v_alias_type,
      'manual_review',
      'high'
    )
    on conflict (rider_id, normalized_alias, alias_type) do nothing
    returning id into v_alias_id;
  end if;

  return jsonb_build_object(
    'status', 'resolved',
    'item_id', p_item_id,
    'resolved_status', p_status,
    'alias_id', v_alias_id
  );
end;
$$;

comment on function public.resolve_uci_rider_review_item(uuid, public.uci_rider_review_queue_status, uuid, text, jsonb) is
  'Resolves a public.uci_rider_review_queue item (status -> matched/new_rider_approved/source_correction/ignored/resolved), optionally inserting a new public.uci_rider_aliases row in the same call when p_create_alias is supplied. Requires grandtour_private.is_cycling_admin() internally; callable by service_role (CLI, scripts/uci-rider-review.mjs) or by an authenticated cycling admin''s own session.';

revoke all on function public.resolve_uci_rider_review_item(uuid, public.uci_rider_review_queue_status, uuid, text, jsonb)
from public, anon, authenticated;

grant execute on function public.resolve_uci_rider_review_item(uuid, public.uci_rider_review_queue_status, uuid, text, jsonb)
to authenticated, service_role;
