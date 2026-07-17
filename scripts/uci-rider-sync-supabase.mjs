/**
 * Thin DB-access layer for the UCI rider registry sync (scripts/
 * uci-rider-sync.mjs), mirroring the grandtour-reconciliation-supabase.mjs
 * (anon-key reads) / grandtour-apply.mjs (service-role writes) split
 * already used by the official-letour results pipeline.
 *
 * Read functions here use whichever client the caller supplies (anon key
 * for a --dry-run compare step; service-role for --apply, which needs to
 * read-before-write anyway). Write functions require a service-role
 * client -- callers are responsible for constructing the right client
 * (see scripts/uci-rider-sync.mjs's requireAnonClient/requireServiceClient
 * helpers, following scripts/tdf-2026-rider-importer.mjs's existing
 * pattern).
 */

export async function fetchExistingUciRiders(client, { discipline } = {}) {
  let query = client
    .from("uci_riders")
    .select("id, uci_rider_id, uci_code, given_name, family_name, display_name, normalized_name, date_of_birth, nationality, gender, discipline, current_team_name, current_team_code, uci_profile_url, is_active, last_seen_at, consecutive_absences, data_confidence, manual_review_required, last_verified_at");
  if (discipline) query = query.eq("discipline", discipline);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to read uci_riders: ${error.message}`);
  return data ?? [];
}

export async function fetchExistingAliasesForRiders(client, riderIds) {
  if (!riderIds || riderIds.length === 0) return [];
  const { data, error } = await client
    .from("uci_rider_aliases")
    .select("id, rider_id, alias_text, normalized_alias, alias_type, source, confidence")
    .in("rider_id", riderIds);
  if (error) throw new Error(`Failed to read uci_rider_aliases: ${error.message}`);
  return data ?? [];
}

export async function fetchExistingTeamHistoryForRiders(client, riderIds) {
  if (!riderIds || riderIds.length === 0) return [];
  const { data, error } = await client
    .from("uci_rider_team_history")
    .select("id, rider_id, team_id, source_team_name, source_team_code, season_year, source")
    .in("rider_id", riderIds);
  if (error) throw new Error(`Failed to read uci_rider_team_history: ${error.message}`);
  return data ?? [];
}

export async function fetchExistingSpecialtiesForRiders(client, riderIds, season) {
  if (!riderIds || riderIds.length === 0) return [];
  const { data, error } = await client
    .from("uci_rider_specialties")
    .select("id, rider_id, season, primary_specialty, secondary_specialty, confidence, source, manually_reviewed")
    .in("rider_id", riderIds)
    .eq("season", season);
  if (error) throw new Error(`Failed to read uci_rider_specialties: ${error.message}`);
  return data ?? [];
}

export async function fetchGrandTourTeamsIndex(client, { grandTourId } = {}) {
  if (!grandTourId) return [];
  const { data, error } = await client
    .from("grandtour_teams")
    .select("id, name, code")
    .eq("grand_tour_id", grandTourId);
  if (error) throw new Error(`Failed to read grandtour_teams: ${error.message}`);
  return data ?? [];
}

/**
 * Applies one registry sync plan (from scripts/uci-rider-registry.mjs's
 * planRegistrySync) to Supabase, service-role only. Inserts first (so
 * subsequently-planned alias/team-history/specialty rows referencing a
 * freshly-inserted rider_id have a real id to point at), then updates.
 * Never touches `unchanged` entries. Returns the applied row ids keyed by
 * the incoming record's identity, so the caller can plan satellite writes
 * against them.
 */
export async function applyRegistryPlan(client, plan) {
  const insertedIds = [];
  if (plan.inserts.length > 0) {
    const rows = plan.inserts.map(({ row }) => {
      const { id, ...rest } = row;
      return rest;
    });
    const { data, error } = await client.from("uci_riders").insert(rows).select("id, uci_rider_id, normalized_name");
    if (error) throw new Error(`Failed to insert uci_riders: ${error.message}`);
    insertedIds.push(...(data ?? []));
  }

  if (plan.updates.length > 0) {
    for (const { row } of plan.updates) {
      const { id, ...rest } = row;
      const { error } = await client.from("uci_riders").update(rest).eq("id", id);
      if (error) throw new Error(`Failed to update uci_riders row ${id}: ${error.message}`);
    }
  }

  return { insertedIds, insertedCount: plan.inserts.length, updatedCount: plan.updates.length };
}

export async function applyAliasInserts(client, inserts) {
  if (!inserts || inserts.length === 0) return { insertedCount: 0 };
  const { error } = await client.from("uci_rider_aliases").insert(inserts);
  if (error) throw new Error(`Failed to insert uci_rider_aliases: ${error.message}`);
  return { insertedCount: inserts.length };
}

export async function applyTeamHistoryPlan(client, { inserts = [], updates = [] }) {
  if (inserts.length > 0) {
    const { error } = await client.from("uci_rider_team_history").insert(inserts);
    if (error) throw new Error(`Failed to insert uci_rider_team_history: ${error.message}`);
  }
  for (const row of updates) {
    const { id, ...rest } = row;
    const { error } = await client.from("uci_rider_team_history").update(rest).eq("id", id);
    if (error) throw new Error(`Failed to update uci_rider_team_history row ${id}: ${error.message}`);
  }
  return { insertedCount: inserts.length, updatedCount: updates.length };
}

export async function applySpecialtyPlan(client, planned) {
  const inserts = planned.filter((entry) => entry.action === "insert").map((entry) => entry.row);
  const updates = planned.filter((entry) => entry.action === "update").map((entry) => entry.row);

  if (inserts.length > 0) {
    const { error } = await client.from("uci_rider_specialties").insert(inserts);
    if (error) throw new Error(`Failed to insert uci_rider_specialties: ${error.message}`);
  }
  for (const row of updates) {
    const { id, ...rest } = row;
    const { error } = await client.from("uci_rider_specialties").update(rest).eq("id", id);
    if (error) throw new Error(`Failed to update uci_rider_specialties row ${id}: ${error.message}`);
  }
  return { insertedCount: inserts.length, updatedCount: updates.length };
}

export async function insertReviewItems(client, items) {
  if (!items || items.length === 0) return { insertedCount: 0 };
  const rows = items.map((item) => ({
    queue_type: item.queueType,
    rider_id: item.riderId ?? null,
    candidate_payload: item.candidatePayload ?? {},
    reason: item.reason ?? null,
    source: item.source ?? "uci_sync",
  }));
  const { error } = await client.from("uci_rider_review_queue").insert(rows);
  if (error) throw new Error(`Failed to insert uci_rider_review_queue: ${error.message}`);
  return { insertedCount: rows.length };
}

export async function insertSyncRun(client, row) {
  const { data, error } = await client.from("uci_rider_sync_runs").insert(row).select("id").single();
  if (error) throw new Error(`Failed to insert uci_rider_sync_runs: ${error.message}`);
  return data.id;
}

export async function updateSyncRun(client, id, patch) {
  const { error } = await client.from("uci_rider_sync_runs").update(patch).eq("id", id);
  if (error) throw new Error(`Failed to update uci_rider_sync_runs row ${id}: ${error.message}`);
}

export async function fetchPendingReviewItems(client, { status = "pending" } = {}) {
  const { data, error } = await client
    .from("uci_rider_review_queue")
    .select("id, queue_type, status, rider_id, grandtour_rider_id, candidate_payload, reason, source, created_at")
    .eq("status", status)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to read uci_rider_review_queue: ${error.message}`);
  return data ?? [];
}
