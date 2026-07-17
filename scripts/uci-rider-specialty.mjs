import { resolveSpecialty, SPECIALTY_SOURCES, SUPPORTED_SPECIALTIES } from "./tdf-2026-rider-specialty.mjs";

/**
 * Season-aware specialty planning for `uci_rider_specialties`. Imports
 * (does not duplicate) `SUPPORTED_SPECIALTIES`/`resolveSpecialty` from
 * scripts/tdf-2026-rider-specialty.mjs -- the vocabulary and "never infer
 * from UCI data" rule both come from there unchanged. UCI's rider-details
 * payload has no specialty/discipline-score field at all (confirmed by
 * scripts/uci-parsers.mjs's parseUciRiderDetailsHtml, which extracts only
 * name/DOB/nationality/team/team-history), so this module never computes
 * a fresh classification either -- it only ever retains a trusted
 * existing value (source="existing_supabase") or reports "unknown".
 */

export { SUPPORTED_SPECIALTIES, SPECIALTY_SOURCES };

/**
 * Plans the `uci_rider_specialties` upsert for one rider/season, given
 * whatever specialty is already recorded for that rider+season (if any)
 * and, optionally, an already-known `existingGrandTourSpecialities` array
 * (a tour-scoped `grandtour_riders.specialities` value, when this rider
 * has already been matched to a race entry -- the migration path from
 * the Tour 2026 importer, see scripts/tdf-2026-registry-match-report.mjs).
 *
 * `manually_reviewed` on an existing row is always preserved outright: a
 * manual review is never silently overwritten by a resync, regardless of
 * what `existingGrandTourSpecialities` says this time.
 */
export function planRiderSpecialtySync({ riderId, season, existingSpecialtyRow = null, existingGrandTourSpecialities = null }) {
  if (existingSpecialtyRow?.manually_reviewed) {
    return { action: "unchanged", row: existingSpecialtyRow, reason: "manually_reviewed_preserved" };
  }

  const resolved = resolveSpecialty({ existingSpecialities: existingGrandTourSpecialities });

  const row = {
    rider_id: riderId,
    season,
    primary_specialty: resolved.primarySpecialty,
    secondary_specialty: resolved.secondarySpecialty,
    confidence: resolved.specialtySource === "existing_supabase" ? "medium" : "low",
    evidence: existingGrandTourSpecialities ? { existingGrandTourSpecialities } : {},
    source: resolved.specialtySource,
    manually_reviewed: false,
  };

  if (!existingSpecialtyRow) {
    return { action: "insert", row };
  }

  const unchanged = existingSpecialtyRow.primary_specialty === row.primary_specialty
    && existingSpecialtyRow.secondary_specialty === row.secondary_specialty
    && existingSpecialtyRow.source === row.source;

  if (unchanged) {
    return { action: "unchanged", row: existingSpecialtyRow };
  }

  return { action: "update", row: { id: existingSpecialtyRow.id, ...row } };
}
