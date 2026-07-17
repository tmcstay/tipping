import type { Json } from "@tipping-suite/shared-types";

import { getSupabaseClient } from "./client";
import { dedupeIds } from "./uciRiderIdUtils";

export { dedupeIds } from "./uciRiderIdUtils";

/**
 * Admin-only data layer for the UCI rider review queue admin page
 * (apps/mobile/app/admin/uci-rider-review.tsx). Follows grandtourAdmin.ts's
 * exact conventions: the app's normal publishable/anon key only (never
 * service-role), one un-joined `.select()` per table aggregated
 * client-side into Map/array lookups by the caller - never a Postgrest
 * join. Writes go through the two RPCs
 * (confirm_grandtour_rider_master_link, resolve_uci_rider_review_item),
 * which are both auth.uid()-checked (grandtour_private.is_cycling_admin())
 * server-side - this module never writes to
 * uci_rider_review_queue/grandtour_riders/uci_rider_aliases directly.
 */

/** Mirrors public.uci_rider_review_queue_status (20260717040000_uci_rider_review_queue_and_sync_runs.sql). */
export type UciRiderReviewQueueStatus =
  | "pending"
  | "matched"
  | "new_rider_approved"
  | "source_correction"
  | "ignored"
  | "resolved";

export type UciRiderReviewQueueItem = {
  id: string;
  queueType: string;
  status: string;
  riderId: string | null;
  grandtourRiderId: string | null;
  candidatePayload: Json;
  reason: string | null;
  source: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Lists review-queue items by status (default "pending", the only status
 * the admin page needs to triage - matched/ignored/etc. items are already
 * resolved and have nothing left to act on). RLS ("Cycling admins can view
 * the UCI rider review queue") already restricts this to admins; this
 * function does no additional authorization itself, same as every read in
 * grandtourAdmin.ts.
 */
export async function listUciRiderReviewQueue(
  input: { status?: UciRiderReviewQueueStatus } = {}
): Promise<UciRiderReviewQueueItem[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("uci_rider_review_queue")
    .select(
      "id, queue_type, status, rider_id, grandtour_rider_id, candidate_payload, reason, source, resolved_by, resolved_at, resolution_note, created_at, updated_at"
    )
    .eq("status", input.status ?? "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    queueType: row.queue_type,
    status: row.status,
    riderId: row.rider_id,
    grandtourRiderId: row.grandtour_rider_id,
    candidatePayload: row.candidate_payload,
    reason: row.reason,
    source: row.source,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export type UciRiderRecord = {
  id: string;
  uciRiderId: string | null;
  displayName: string;
  normalizedName: string;
  nationality: string | null;
  currentTeamName: string | null;
  dateOfBirth: string | null;
};

/** Batch-loads uci_riders rows by id (public-read RLS - no admin gate needed on this table itself). Returns [] immediately for an empty id list, without querying. */
export async function getUciRidersByIds(ids: string[]): Promise<UciRiderRecord[]> {
  const uniqueIds = dedupeIds(ids);
  if (uniqueIds.length === 0) return [];
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("uci_riders")
    .select("id, uci_rider_id, display_name, normalized_name, nationality, current_team_name, date_of_birth")
    .in("id", uniqueIds);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    uciRiderId: row.uci_rider_id,
    displayName: row.display_name,
    normalizedName: row.normalized_name,
    nationality: row.nationality,
    currentTeamName: row.current_team_name,
    dateOfBirth: row.date_of_birth
  }));
}

export type GrandTourRiderRecord = {
  id: string;
  displayName: string;
  country: string | null;
  masterRiderId: string | null;
};

/** Batch-loads grandtour_riders rows by id (public-read RLS). Returns [] immediately for an empty id list, without querying. */
export async function getGrandTourRidersByIds(ids: string[]): Promise<GrandTourRiderRecord[]> {
  const uniqueIds = dedupeIds(ids);
  if (uniqueIds.length === 0) return [];
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("grandtour_riders")
    .select("id, display_name, country, master_rider_id")
    .in("id", uniqueIds);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    country: row.country,
    masterRiderId: row.master_rider_id
  }));
}

/**
 * Confirms a grandtour_riders <-> uci_riders link via
 * confirm_grandtour_rider_master_link (see
 * supabase/migrations/20260717060000_confirm_grandtour_rider_master_link_rpc.sql).
 * When reviewItemId is supplied, the same call also marks that queue item
 * "matched" and (optionally) records a new alias - all in one transaction.
 */
export async function confirmGrandTourRiderMasterLink(input: {
  grandtourRiderId: string;
  uciRiderId: string;
  confirmedBy: string;
  reviewItemId?: string | null;
  note?: string | null;
  createAlias?: { riderId: string; aliasText: string; aliasType: string } | null;
}): Promise<unknown> {
  const { data, error } = await getSupabaseClient().rpc("confirm_grandtour_rider_master_link", {
    p_grandtour_rider_id: input.grandtourRiderId,
    p_uci_rider_id: input.uciRiderId,
    p_confirmed_by: input.confirmedBy,
    p_review_item_id: input.reviewItemId ?? undefined,
    p_note: input.note ?? undefined,
    p_create_alias: input.createAlias
      ? { rider_id: input.createAlias.riderId, alias_text: input.createAlias.aliasText, alias_type: input.createAlias.aliasType }
      : undefined
  });
  if (error) throw error;
  return data;
}

/**
 * Resolves a review-queue item without linking anything (Approve as new
 * rider / Ignore / Flag for source correction) via
 * resolve_uci_rider_review_item (pre-existing, see
 * supabase/migrations/20260717040000_uci_rider_review_queue_and_sync_runs.sql).
 */
export async function resolveUciRiderReviewItem(input: {
  itemId: string;
  status: "new_rider_approved" | "source_correction" | "ignored" | "resolved" | "matched";
  resolvedBy: string;
  note?: string | null;
}): Promise<unknown> {
  const { data, error } = await getSupabaseClient().rpc("resolve_uci_rider_review_item", {
    p_item_id: input.itemId,
    p_status: input.status,
    p_resolved_by: input.resolvedBy,
    p_note: input.note ?? undefined
  });
  if (error) throw error;
  return data;
}
