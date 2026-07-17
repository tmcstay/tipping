// Specialty resolution and young-rider eligibility for the TDF 2026 rider
// importer. Pure functions, no I/O.
//
// Specialty, this iteration: UCI's public rider-details payload (see
// scripts/uci-parsers.mjs) has no structured specialty/discipline
// score field at all — just name, DOB, nationality, current team, and
// team history. Earlier versions of this importer derived a specialty
// from ProCyclingStats' "points per specialty" scores; PCS has since been
// removed from the source hierarchy entirely (see CLAUDE.md), and this
// importer does not claim UCI provides specialty data it doesn't have.
// `resolveSpecialty` therefore never computes a *fresh* classification —
// it only ever preserves whatever specialty already exists in Supabase
// (or is unknown), leaving real result-based specialty enrichment to a
// later iteration.

export const SUPPORTED_SPECIALTIES = [
  "gc",
  "climber",
  "sprinter",
  "puncheur",
  "time_trial",
  "classics",
  "rouleur",
  "all_rounder",
  "domestique",
  "unknown",
];

// `specialty_source`'s possible values, per this task's spec. This
// importer only ever produces the first two — "manual" is reserved for a
// future session that adds a real manual-review/provenance column to
// `grandtour_riders` (none exists today; see the DB_SPECIALITY_TO_OUTPUT
// mapping's own note on why a schema gap, not a bug in this file, is why
// "manually reviewed" specialty can't currently be distinguished from any
// other pre-existing value).
export const SPECIALTY_SOURCES = ["existing_supabase", "manual", "unknown"];

// Best-effort *display-only* mapping from the DB's existing
// `grandtour_riders.specialities` check-constraint vocabulary (gc, sprint,
// mountain, time_trial, classics, all_rounder, domestique, leadout,
// breakaway — see supabase/migrations/20260629080958_grandtour_mvp.sql)
// onto this importer's narrower ten-value output vocabulary, so an
// existing DB value can be reported in `primary_specialty` without
// inventing a new output category. `leadout`/`breakaway` have no faithful
// 1:1 equivalent in the output vocabulary and are reported as "unknown"
// for *display* purposes only — this mapping is never used to write back
// to the database (this importer never re-derives and overwrites the
// `specialities` array; see tdf-2026-rider-match.mjs's null-safe merge,
// which leaves an existing DB value untouched whenever the incoming
// record supplies no `specialities` of its own), so no information is
// actually lost in the database itself, only in this one display field.
const DB_SPECIALITY_TO_OUTPUT_VOCAB = {
  gc: "gc",
  sprint: "sprinter",
  mountain: "climber",
  time_trial: "time_trial",
  classics: "classics",
  all_rounder: "all_rounder",
  domestique: "domestique",
};

/**
 * Resolves the specialty fields to report for a rider, per this
 * iteration's rule: preserve whatever's already in Supabase
 * (`existingSpecialities`, the raw `grandtour_riders.specialities`
 * array or null), else "unknown". Never derives a new classification
 * from any external source. `existingSpecialities[0]` is used as the
 * primary value (the DB column has no notion of "primary" vs
 * "secondary" — it's a flat array — so this importer reports the first
 * entry as primary and always "unknown" for secondary rather than
 * guessing which of several existing tags is more significant).
 */
export function resolveSpecialty({ existingSpecialities } = {}) {
  const first = Array.isArray(existingSpecialities) ? existingSpecialities.find(Boolean) : null;
  if (!first) {
    return { primarySpecialty: "unknown", secondarySpecialty: "unknown", specialtySource: "unknown" };
  }
  return {
    primarySpecialty: DB_SPECIALITY_TO_OUTPUT_VOCAB[first] ?? "unknown",
    secondarySpecialty: "unknown",
    specialtySource: "existing_supabase",
  };
}

// Young-rider (white jersey) eligibility. This is the UCI/ASO rule this
// project adopts, unchanged since it was introduced for the white jersey
// classification: a rider is eligible if they are 25 years old or
// younger during the calendar year the race is held, i.e. born on or
// after 1 January of (race year - 25). This is a fixed calendar cutoff,
// never derived from the rider's age on "today" (today's date is
// irrelevant to a rule keyed on the race year).
export const YOUNG_RIDER_ELIGIBILITY_RULE_SOURCE =
  "UCI/ASO young rider (white jersey) classification: riders aged 25 or younger during the calendar year of the race, i.e. born on or after 1 January of (race year - 25).";

export function youngRiderEligibilityCutoffDate(raceYear) {
  return `${raceYear - 25}-01-01`;
}

/**
 * `dateOfBirth` must be an ISO `YYYY-MM-DD` string (or null/undefined for
 * "unknown" — returns `null`, never a guessed true/false). Boundary is
 * inclusive: a rider born exactly on the cutoff date is eligible.
 */
export function isYoungRiderEligible(dateOfBirth, raceYear) {
  if (!dateOfBirth) return null;
  const cutoff = youngRiderEligibilityCutoffDate(raceYear);
  return dateOfBirth >= cutoff;
}

export function buildYoungRiderEligibility(dateOfBirth, raceYear) {
  return {
    young_rider_eligible: isYoungRiderEligible(dateOfBirth, raceYear),
    eligibility_cutoff_date: youngRiderEligibilityCutoffDate(raceYear),
    eligibility_rule_source: YOUNG_RIDER_ELIGIBILITY_RULE_SOURCE,
  };
}
