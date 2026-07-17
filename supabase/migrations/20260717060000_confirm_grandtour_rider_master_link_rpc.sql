-- Confirms a human-reviewed link between a Tour-scoped public.grandtour_riders
-- row and the cross-race master public.uci_riders identity. See CLAUDE.md's
-- "Master UCI Rider Registry & Weekly Sync" section -- that session shipped
-- grandtour_riders.master_rider_id (20260717050000) and the review queue +
-- resolve_uci_rider_review_item RPC (20260717040000), but nothing yet
-- actually WROTE master_rider_id; resolve_uci_rider_review_item only ever
-- updates the queue row (+ optionally an alias), never the link column.
-- This RPC is the missing piece the admin review page needs: it sets
-- grandtour_riders.master_rider_id, and -- when a review-queue item is
-- being resolved by this same confirmation -- marks that item 'matched' and
-- optionally records a new alias, all in one transaction.
--
-- Same service_role-or-cycling-admin guard pattern as
-- resolve_uci_rider_review_item/mark_grandtour_stage_result_checked.

create function public.confirm_grandtour_rider_master_link(
  p_grandtour_rider_id uuid,
  p_uci_rider_id uuid,
  p_confirmed_by uuid,
  p_review_item_id uuid default null,
  p_note text default null,
  p_create_alias jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grandtour_rider_exists boolean;
  v_uci_rider_exists boolean;
  v_current_master_rider_id uuid;
  v_status text;
  v_review_item record;
  v_alias_rider_id uuid;
  v_alias_text text;
  v_alias_type public.uci_rider_alias_type;
  v_alias_id uuid;
begin
  if auth.role() <> 'service_role' and not grandtour_private.is_cycling_admin() then
    raise exception 'confirm_grandtour_rider_master_link: GrandTour administrator access is required.';
  end if;

  select exists(select 1 from public.grandtour_riders where id = p_grandtour_rider_id)
  into v_grandtour_rider_exists;
  if not v_grandtour_rider_exists then
    raise exception 'confirm_grandtour_rider_master_link: no public.grandtour_riders row found for id %.', p_grandtour_rider_id;
  end if;

  select exists(select 1 from public.uci_riders where id = p_uci_rider_id)
  into v_uci_rider_exists;
  if not v_uci_rider_exists then
    raise exception 'confirm_grandtour_rider_master_link: no public.uci_riders row found for id %.', p_uci_rider_id;
  end if;

  select master_rider_id into v_current_master_rider_id
  from public.grandtour_riders
  where id = p_grandtour_rider_id;

  if v_current_master_rider_id is distinct from p_uci_rider_id then
    update public.grandtour_riders
    set master_rider_id = p_uci_rider_id
    where id = p_grandtour_rider_id;
    v_status := 'linked';
  else
    v_status := 'no_change';
  end if;

  if p_review_item_id is not null then
    select id, status into v_review_item
    from public.uci_rider_review_queue
    where id = p_review_item_id;

    if v_review_item.id is null then
      raise exception 'confirm_grandtour_rider_master_link: no uci_rider_review_queue row found for id %.', p_review_item_id;
    end if;

    update public.uci_rider_review_queue
    set status = 'matched',
        resolved_by = p_confirmed_by,
        resolved_at = now(),
        resolution_note = p_note
    where id = p_review_item_id;
  end if;

  -- Same alias-insert shape as resolve_uci_rider_review_item -- an admin
  -- confirming a match can, in the same step, teach the registry that
  -- race-entry name as a reusable alias for next time.
  v_alias_id := null;
  if p_create_alias is not null then
    v_alias_rider_id := (p_create_alias ->> 'rider_id')::uuid;
    v_alias_text := p_create_alias ->> 'alias_text';
    v_alias_type := (p_create_alias ->> 'alias_type')::public.uci_rider_alias_type;

    if v_alias_rider_id is null or v_alias_text is null or v_alias_type is null then
      raise exception 'confirm_grandtour_rider_master_link: p_create_alias requires rider_id, alias_text, and alias_type.';
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
    'status', v_status,
    'grandtour_rider_id', p_grandtour_rider_id,
    'uci_rider_id', p_uci_rider_id,
    'review_item_id', p_review_item_id,
    'alias_id', v_alias_id
  );
end;
$$;

comment on function public.confirm_grandtour_rider_master_link(uuid, uuid, uuid, uuid, text, jsonb) is
  'Sets public.grandtour_riders.master_rider_id, optionally marks a public.uci_rider_review_queue row status=matched, and optionally inserts a public.uci_rider_aliases row -- all in one transaction. Idempotent: re-confirming the same grandtour_rider_id/uci_rider_id pair returns status=no_change and does not re-update the link column (though a supplied review item/alias are still processed). Requires grandtour_private.is_cycling_admin() internally; callable by service_role or by an authenticated cycling admin''s own session.';

revoke all on function public.confirm_grandtour_rider_master_link(uuid, uuid, uuid, uuid, text, jsonb)
from public, anon, authenticated;

grant execute on function public.confirm_grandtour_rider_master_link(uuid, uuid, uuid, uuid, text, jsonb)
to authenticated, service_role;
