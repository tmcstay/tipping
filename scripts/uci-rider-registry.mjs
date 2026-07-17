import crypto from "node:crypto";

import { normalizeRiderName } from "./tdf-data-utils.mjs";

/**
 * Canonical-rider merge/match logic against `public.uci_riders` (the
 * cross-race master registry -- see supabase/migrations/20260717020000_
 * uci_rider_registry_schema.sql), as opposed to
 * scripts/tdf-2026-rider-match.mjs, which merges into the tour-scoped
 * `public.grandtour_riders`. Pure, no I/O -- callers (scripts/uci-rider-sync.mjs)
 * supply already-fetched UCI records and already-read existing rows.
 *
 * Matching priority: uci_rider_id (primary, an opaque stable UCI-assigned
 * id) then normalized_name (fallback, flagged non-authoritative since
 * names are never a unique key on this table -- see the migration's own
 * comment on why uci_riders.normalized_name carries no unique constraint).
 */

const IDENTITY_FIELD_SOURCE = "uci_rider_id";

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

/**
 * Deterministic content hash over the fields that would actually change a
 * uci_riders row, so an unchanged UCI listing/profile record can be
 * skipped without a write (and, per the sync CLI's own orchestration,
 * without even re-fetching the profile page when the listing-derived hash
 * already matches what's already stored -- see uci-rider-sync.mjs).
 * `public.uci_riders` has no stored hash column, so this is always
 * computed fresh from a row's own field values (either the incoming
 * merged candidate, or the existing DB row reshaped into the same key
 * order) and compared directly -- never persisted. Field order is fixed
 * so the hash is stable across runs/processes.
 */
export function sourceContentHash(record) {
  const canonical = JSON.stringify([
    record.uciRiderId ?? null,
    record.uciCode ?? null,
    record.givenName ?? null,
    record.familyName ?? null,
    record.displayName ?? null,
    record.dateOfBirth ?? null,
    record.nationality ?? null,
    record.gender ?? null,
    record.currentTeamName ?? null,
    record.currentTeamCode ?? null,
    record.uciProfileUrl ?? null,
  ]);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/** Reshapes an existing (snake_case, DB-read) uci_riders row into the same key shape sourceContentHash expects, for a direct existing-vs-merged comparison. */
function existingRowToHashInput(existing) {
  if (!existing) return null;
  return {
    uciRiderId: existing.uci_rider_id ?? null,
    uciCode: existing.uci_code ?? null,
    givenName: existing.given_name ?? null,
    familyName: existing.family_name ?? null,
    displayName: existing.display_name ?? null,
    dateOfBirth: existing.date_of_birth ?? null,
    nationality: existing.nationality ?? null,
    gender: existing.gender ?? null,
    currentTeamName: existing.current_team_name ?? null,
    currentTeamCode: existing.current_team_code ?? null,
    uciProfileUrl: existing.uci_profile_url ?? null,
  };
}

/**
 * Matches one incoming UCI record against the existing uci_riders rows.
 * Priority: 1) uci_rider_id exact match (the strong identity signal); 2)
 * normalized_name (fallback only, flagged `authoritative: false` since
 * multiple riders can legitimately share a name -- more than one candidate
 * at this tier is ambiguous, never guessed).
 */
export function matchCanonicalRider(incoming, existingRiders) {
  if (incoming.uciRiderId) {
    const byId = existingRiders.filter((rider) => rider.uci_rider_id === incoming.uciRiderId);
    if (byId.length === 1) {
      return { match: byId[0], matchMethod: IDENTITY_FIELD_SOURCE, authoritative: true };
    }
    if (byId.length > 1) {
      // Should never happen given the DB's own partial unique index on
      // uci_rider_id, but a stale in-memory read (a prior duplicate that
      // hasn't been cleaned up) must still be reported, not silently
      // collapsed to the first hit.
      return { match: null, matchMethod: null, authoritative: false, ambiguousCandidates: byId, reason: "duplicate_uci_identity" };
    }
  }

  const normalized = normalizeRiderName(incoming.displayName ?? "");
  const byName = existingRiders.filter((rider) => rider.normalized_name === normalized);
  if (byName.length === 1) {
    return { match: byName[0], matchMethod: "normalized_name", authoritative: false };
  }
  if (byName.length > 1) {
    return { match: null, matchMethod: null, authoritative: false, ambiguousCandidates: byName, reason: "ambiguous_name_match" };
  }

  return { match: null, matchMethod: null, authoritative: false, ambiguousCandidates: [] };
}

/**
 * Null-safe field merge, generalizing tdf-2026-rider-match.mjs's
 * mergeRiderField: an incoming value only wins when present; a missing
 * incoming value never regresses an existing one. Confidence/trust is
 * layered on top by mergeDateOfBirthAndNationality below for the two
 * fields that need it -- every other field uses this plain rule.
 */
export function mergeRegistryField(existingValue, incomingValue) {
  return hasValue(incomingValue) ? incomingValue : existingValue ?? null;
}

/**
 * Generalizes tdf-2026-rider-match.mjs's DOB-only conflict rule to BOTH
 * date_of_birth and nationality: a manually-reviewed or otherwise
 * higher-confidence existing value is never silently overwritten by a
 * null or lower-confidence incoming one. When both an existing (trusted)
 * value and a differing incoming value are present, the existing value
 * wins and `conflict: true` is reported -- never silently dropped.
 *
 * `existingManuallyReviewed` (uci_riders.manual_review_required === false
 * AND the row was previously verified -- callers pass this as an explicit
 * boolean, not re-derived here) always wins outright regardless of
 * incoming confidence; otherwise the same high/medium-confidence gate
 * from tdf-2026-rider-match.mjs's mergeDateOfBirth applies.
 */
export function mergeTrustedField({ existingValue, incomingValue, incomingConfidence, existingManuallyReviewed = false }) {
  const incomingUsable = hasValue(incomingValue) && (incomingConfidence === "high" || incomingConfidence === "medium");

  if (existingManuallyReviewed && hasValue(existingValue)) {
    if (incomingUsable && incomingValue !== existingValue) {
      return { value: existingValue, conflict: true, source: "manual" };
    }
    return { value: existingValue, conflict: false, source: "manual" };
  }

  if (!incomingUsable) {
    return { value: existingValue ?? null, conflict: false, source: hasValue(existingValue) ? "existing" : "unknown" };
  }
  if (!hasValue(existingValue)) {
    return { value: incomingValue, conflict: false, source: "uci" };
  }
  if (existingValue === incomingValue) {
    return { value: existingValue, conflict: false, source: "existing" };
  }
  return { value: existingValue, conflict: true, source: "existing" };
}

/**
 * Builds the full merged row (for insert or update) plus conflict flags
 * for one incoming UCI record against its matched existing row (or `null`
 * for a brand-new rider). Never mutates its inputs.
 */
export function mergeCanonicalRiderRecord(existing, incoming) {
  const dob = mergeTrustedField({
    existingValue: existing?.date_of_birth ?? null,
    incomingValue: incoming.dateOfBirth ?? null,
    incomingConfidence: incoming.matchConfidence ?? "medium",
    existingManuallyReviewed: Boolean(existing?.manual_review_required === false && existing?.last_verified_at),
  });
  const nationality = mergeTrustedField({
    existingValue: existing?.nationality ?? null,
    incomingValue: incoming.nationality ?? null,
    incomingConfidence: incoming.matchConfidence ?? "medium",
    existingManuallyReviewed: Boolean(existing?.manual_review_required === false && existing?.last_verified_at),
  });

  const row = {
    id: existing?.id ?? null,
    uci_rider_id: mergeRegistryField(existing?.uci_rider_id, incoming.uciRiderId),
    uci_code: mergeRegistryField(existing?.uci_code, incoming.uciCode),
    given_name: mergeRegistryField(existing?.given_name, incoming.givenName),
    family_name: mergeRegistryField(existing?.family_name, incoming.familyName),
    display_name: mergeRegistryField(existing?.display_name, incoming.displayName),
    normalized_name: normalizeRiderName(mergeRegistryField(existing?.display_name, incoming.displayName) ?? ""),
    date_of_birth: dob.value,
    nationality: nationality.value,
    gender: mergeRegistryField(existing?.gender, incoming.gender),
    discipline: mergeRegistryField(existing?.discipline, incoming.discipline) ?? "road",
    current_team_name: mergeRegistryField(existing?.current_team_name, incoming.currentTeamName),
    current_team_code: mergeRegistryField(existing?.current_team_code, incoming.currentTeamCode),
    uci_profile_url: mergeRegistryField(existing?.uci_profile_url, incoming.uciProfileUrl),
    is_active: true,
    source_updated_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    consecutive_absences: 0,
    data_confidence: incoming.matchConfidence === "high" ? "high" : (incoming.matchConfidence === "medium" ? "medium" : (existing?.data_confidence ?? "low")),
    manual_review_required: existing?.manual_review_required ?? false,
  };

  return {
    row,
    dateOfBirthConflict: dob.conflict,
    nationalityConflict: nationality.conflict,
    contentHash: sourceContentHash({
      uciRiderId: row.uci_rider_id,
      uciCode: row.uci_code,
      givenName: row.given_name,
      familyName: row.family_name,
      displayName: row.display_name,
      dateOfBirth: row.date_of_birth,
      nationality: row.nationality,
      gender: row.gender,
      currentTeamName: row.current_team_name,
      currentTeamCode: row.current_team_code,
      uciProfileUrl: row.uci_profile_url,
    }),
  };
}

/**
 * Builds the full registry sync plan for a batch of incoming UCI records
 * against the existing uci_riders roster. Every incoming record ends up
 * in exactly one of inserts/updates/unchanged/reviewItems -- never
 * silently dropped. `unchanged` short-circuits on a matched existing
 * row's own content hash equalling the freshly computed one, so an
 * identical resync produces zero writes for that rider.
 */
export function planRegistrySync(incomingRiders, existingRiders) {
  const inserts = [];
  const updates = [];
  const unchanged = [];
  const reviewItems = [];
  const seenExistingIds = new Set();
  // Guards a different case than seenExistingIds: two *new* incoming
  // records (no existing registry match) that both carry the same
  // uci_rider_id -- e.g. two roster entries independently name-searched
  // and both resolved (correctly or not) to the same UCI identity. Without
  // this, both would be queued as separate inserts and the second would
  // violate uci_riders' own uci_rider_id unique constraint mid-batch,
  // aborting the whole apply run instead of degrading to a review item.
  const seenIncomingUciRiderIds = new Set();

  for (const incoming of incomingRiders) {
    if (incoming.uciRiderId && seenIncomingUciRiderIds.has(incoming.uciRiderId)) {
      reviewItems.push({ incoming, queueType: "duplicate_uci_identity", candidateIds: [], reason: "same_uci_rider_id_as_another_incoming_record" });
      continue;
    }
    if (incoming.uciRiderId) seenIncomingUciRiderIds.add(incoming.uciRiderId);

    const { match, matchMethod, ambiguousCandidates, reason } = matchCanonicalRider(incoming, existingRiders);

    if (!match && ambiguousCandidates && ambiguousCandidates.length > 1) {
      reviewItems.push({
        incoming,
        queueType: reason === "duplicate_uci_identity" ? "duplicate_uci_identity" : "suspected_duplicate_internal_rider",
        candidateIds: ambiguousCandidates.map((rider) => rider.id),
      });
      continue;
    }

    if (!match) {
      if (!incoming.displayName) {
        reviewItems.push({ incoming, queueType: "unmatched_startlist_rider", candidateIds: [], reason: "missing_display_name" });
        continue;
      }
      const merged = mergeCanonicalRiderRecord(null, incoming);
      inserts.push({ incoming, matchMethod: "new_rider", ...merged });
      if (merged.dateOfBirthConflict || merged.nationalityConflict) {
        reviewItems.push({
          incoming,
          queueType: merged.dateOfBirthConflict ? "dob_conflict" : "nationality_conflict",
          candidateIds: [],
        });
      }
      continue;
    }

    if (seenExistingIds.has(match.id)) {
      reviewItems.push({ incoming, queueType: "duplicate_uci_identity", candidateIds: [match.id], reason: "existing_row_matched_more_than_once" });
      continue;
    }
    seenExistingIds.add(match.id);

    const merged = mergeCanonicalRiderRecord(match, incoming);
    if (merged.dateOfBirthConflict || merged.nationalityConflict) {
      reviewItems.push({
        incoming,
        queueType: merged.dateOfBirthConflict ? "dob_conflict" : "nationality_conflict",
        candidateIds: [match.id],
      });
    }

    const existingHash = sourceContentHash(existingRowToHashInput(match));
    if (!merged.dateOfBirthConflict && !merged.nationalityConflict && merged.contentHash === existingHash) {
      unchanged.push({ incoming, existing: match, matchMethod });
      continue;
    }
    updates.push({ incoming, existing: match, matchMethod, ...merged });
  }

  return {
    inserts,
    updates,
    unchanged,
    reviewItems,
    summary: {
      inserted: inserts.length,
      updated: updates.length,
      unchanged: unchanged.length,
      reviewItems: reviewItems.length,
    },
  };
}
