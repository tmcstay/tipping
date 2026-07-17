import { normalizeRiderName } from "./tdf-data-utils.mjs";

/**
 * Matches the exact normalization `public.grandtour_riders.normalized_name`
 * is generated with in the database (see
 * supabase/migrations/20260630011922_integrate_tdf_2026_data.sql:
 * `lower(regexp_replace(trim(display_name), '\s+', ' ', 'g'))`, and the
 * `grandtour_riders_normalized_name_uidx` unique index built on that
 * column). Deliberately does *not* strip accents the way
 * tdf-data-utils.mjs's `normalizeRiderName` does (that function serves a
 * different, CSV-dataset-level fuzzy-matching pipeline —
 * scripts/grandtour-rider-reconciliation.mjs and
 * scripts/refresh-tdf-2026-official-riders.mjs — with no relationship to
 * this table's own generated column). Using the accent-stripping version
 * here would silently fail to match every existing accented rider name
 * (e.g. an existing "Étienne Caron" row's normalized_name is stored as
 * "étienne caron", not "etienne caron") against this importer's own
 * `normalized_name` writes — a real bug caught by running this importer's
 * own dry run against local seed data and inspecting the result.
 */
export function dbNormalizedName(displayName) {
  return String(displayName).trim().toLowerCase().replace(/\s+/g, " ");
}

// Fields on `public.grandtour_riders` (see
// supabase/migrations/20260629080958_grandtour_mvp.sql,
// .../20260630011922_integrate_tdf_2026_data.sql,
// .../20260703045921_add_grandtour_rider_bib_number.sql,
// .../20260707024106_park_jersey_tips_add_rider_feed_metadata.sql, and the
// generated packages/shared-types/src/database.ts) that this importer is
// allowed to write. No column is invented — anything the task asked for
// that has no matching column (primary_specialty, secondary_specialty,
// specialty raw scores, young_rider_eligible, eligibility_cutoff_date,
// eligibility_rule_source) is computed and reported in the CSV/JSON/review
// output only, never written to the database.
// date_of_birth is deliberately *not* in this list — it has its own
// confidence-gated merge rule (mergeDateOfBirth below), not the generic
// "incoming wins if present" rule every other field uses, per this task's
// "never overwrite a non-null value with null or lower-confidence data"
// requirement and "only high/medium-confidence [UCI] matches may
// automatically populate DOB".
export const WRITABLE_RIDER_FIELDS = [
  "display_name",
  "normalized_name",
  "nationality",
  "bib_number",
  "team_id",
  "status",
  "source_url",
  "specialities",
  "data_confidence",
];

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

/**
 * Never overwrites a valid existing value with an incoming null/blank,
 * applied to every writable field *except* date_of_birth (see
 * `mergeDateOfBirth`) so a partial source fetch can never regress
 * previously-known data. An incoming value that genuinely differs from a
 * non-null existing value *does* win (this is a refresh, not a one-way
 * ratchet) — only a missing incoming value defers to what's already
 * there.
 */
export function mergeRiderField(existingValue, incomingValue) {
  return hasValue(incomingValue) ? incomingValue : existingValue ?? null;
}

/**
 * date_of_birth's own merge rule — stricter than `mergeRiderField`
 * because a wrong DOB (a bad automated match) is worse than a missing
 * one, and because the source now behind DOB (UCI, via a scored/ranked
 * name match) can be wrong in a way the old rule never had to consider
 * (a plain "field present or not" source didn't have a confidence tier).
 *   - `matchConfidence` "low" (or no incoming value at all): the incoming
 *     DOB is never trusted enough to write, regardless of whether an
 *     existing value is present — this is what "only high/medium
 *     confidence matches may populate DOB" means concretely.
 *   - No existing DOB, a usable (high/medium-confidence) incoming one:
 *     takes it, `source: "uci"`.
 *   - Existing and incoming both present and equal: no-op, still
 *     `"existing_supabase"`.
 *   - Existing and incoming both present and *different*: keeps the
 *     existing (trusted) value and reports `conflict: true` — this is
 *     the "DOB conflict preserves trusted existing value" rule. The
 *     caller is expected to surface `conflict` in the review output and
 *     source summary counts, not silently drop it.
 */
export function mergeDateOfBirth({ existingDob, incomingDob, matchConfidence }) {
  const incomingUsable = hasValue(incomingDob) && (matchConfidence === "high" || matchConfidence === "medium");
  if (!incomingUsable) {
    return { value: existingDob ?? null, source: hasValue(existingDob) ? "existing_supabase" : "unknown", conflict: false };
  }
  if (!hasValue(existingDob)) {
    return { value: incomingDob, source: "uci", conflict: false };
  }
  if (existingDob === incomingDob) {
    return { value: existingDob, source: "existing_supabase", conflict: false };
  }
  return { value: existingDob, source: "existing_supabase", conflict: true };
}

/**
 * `incoming.uci_match_confidence` (set by the importer's UCI matching
 * step; absent/undefined is treated the same as "low" — no confidence
 * evidence means no automated DOB write) drives the date_of_birth merge;
 * every other writable field uses the generic null-safe rule. Returns
 * `{ row, dateOfBirthConflict, dateOfBirthSource }` rather than just the
 * row, so callers can report the DOB conflict/source without
 * re-implementing this logic themselves.
 */
export function mergeRiderRecord(existing, incoming) {
  const row = { id: existing?.id ?? null };
  for (const field of WRITABLE_RIDER_FIELDS) {
    row[field] = mergeRiderField(existing?.[field], incoming[field]);
  }
  const dob = mergeDateOfBirth({
    existingDob: existing?.date_of_birth,
    incomingDob: incoming.date_of_birth,
    matchConfidence: incoming.uci_match_confidence,
  });
  row.date_of_birth = dob.value;
  return { row, dateOfBirthConflict: dob.conflict, dateOfBirthSource: dob.source };
}

/**
 * Matches one incoming (parsed + classified) rider against the existing
 * `grandtour_riders` rows for the same grand tour, in priority order:
 *   1. External ID — this schema has no dedicated external-id column, so
 *      the already-established convention (see
 *      scripts/refresh-tdf-2026-official-riders.mjs) of using the
 *      source-of-record profile URL as a stable external identifier is
 *      reused: an exact `source_url` match is as strong a signal as a
 *      dedicated id column would be, since that URL embeds letour.fr's
 *      own numeric rider id and never changes for a given rider.
 *   2. Normalized full name (`normalizeRiderName`, matching the DB's own
 *      `normalized_name` unique-per-tour index) — exactly one candidate
 *      required; more than one is ambiguous and reported for manual
 *      review rather than guessed.
 */
export function matchRider(incoming, existingRiders) {
  if (incoming.source_url) {
    const bySourceUrl = existingRiders.filter((rider) => rider.source_url === incoming.source_url);
    if (bySourceUrl.length === 1) {
      return { match: bySourceUrl[0], matchMethod: "external_id" };
    }
    if (bySourceUrl.length > 1) {
      return { match: null, matchMethod: null, ambiguousCandidates: bySourceUrl };
    }
  }

  const normalized = incoming.normalized_name;
  const byName = existingRiders.filter((rider) => rider.normalized_name === normalized);
  if (byName.length === 1) {
    return { match: byName[0], matchMethod: "normalized_name" };
  }
  if (byName.length > 1) {
    return { match: null, matchMethod: null, ambiguousCandidates: byName };
  }

  return { match: null, matchMethod: null, ambiguousCandidates: [] };
}

/**
 * Builds the full reconciliation plan for a batch of incoming riders
 * against the existing roster. Never mutates its inputs. Every incoming
 * rider ends up in exactly one of `inserts`/`updates`/`unresolved` — an
 * unresolved entry is what the caller writes to the review CSV, never
 * silently dropped.
 */
export function planRiderImport(incomingRiders, existingRiders) {
  const inserts = [];
  const updates = [];
  const unresolved = [];
  const duplicateMatches = [];
  const seenExistingIds = new Set();

  for (const incoming of incomingRiders) {
    const { match, matchMethod, ambiguousCandidates } = matchRider(incoming, existingRiders);

    if (!match && ambiguousCandidates && ambiguousCandidates.length > 1) {
      duplicateMatches.push({
        incoming,
        candidateIds: ambiguousCandidates.map((rider) => rider.id),
        reason: incoming.source_url && ambiguousCandidates.every((rider) => rider.source_url === incoming.source_url)
          ? "multiple_existing_rows_share_source_url"
          : "multiple_existing_rows_share_normalized_name",
      });
      unresolved.push({ incoming, reason: "ambiguous_match", candidateIds: ambiguousCandidates.map((rider) => rider.id) });
      continue;
    }

    if (!match) {
      if (!incoming.display_name || !incoming.normalized_name) {
        unresolved.push({ incoming, reason: "missing_required_fields", candidateIds: [] });
        continue;
      }
      const merged = mergeRiderRecord(null, incoming);
      inserts.push({ incoming, matchMethod: "new_rider", ...merged });
      continue;
    }

    if (seenExistingIds.has(match.id)) {
      duplicateMatches.push({ incoming, candidateIds: [match.id], reason: "existing_row_matched_more_than_once" });
      unresolved.push({ incoming, reason: "existing_row_matched_more_than_once", candidateIds: [match.id] });
      continue;
    }
    seenExistingIds.add(match.id);
    const merged = mergeRiderRecord(match, incoming);
    updates.push({ incoming, existing: match, matchMethod, ...merged });
  }

  const dobConflicts = [...inserts, ...updates].filter((entry) => entry.dateOfBirthConflict).length;

  return {
    inserts,
    updates,
    unresolved,
    duplicateMatches,
    summary: {
      matched: updates.length,
      inserted: inserts.length,
      unresolved: unresolved.length,
      duplicateMatches: duplicateMatches.length,
      dobConflicts,
    },
  };
}

export { normalizeRiderName };
