import assert from "node:assert/strict";
import test from "node:test";

import {
  buildYoungRiderEligibility,
  isYoungRiderEligible,
  resolveSpecialty,
  SPECIALTY_SOURCES,
  SUPPORTED_SPECIALTIES,
  youngRiderEligibilityCutoffDate,
} from "./tdf-2026-rider-specialty.mjs";

test("resolveSpecialty preserves an existing Supabase specialty and reports its source", () => {
  const result = resolveSpecialty({ existingSpecialities: ["mountain"] });
  assert.equal(result.primarySpecialty, "climber");
  assert.equal(result.secondarySpecialty, "unknown");
  assert.equal(result.specialtySource, "existing_supabase");
});

test("resolveSpecialty maps every DB-vocabulary value it can, and falls back to unknown for the rest", () => {
  assert.equal(resolveSpecialty({ existingSpecialities: ["gc"] }).primarySpecialty, "gc");
  assert.equal(resolveSpecialty({ existingSpecialities: ["sprint"] }).primarySpecialty, "sprinter");
  assert.equal(resolveSpecialty({ existingSpecialities: ["time_trial"] }).primarySpecialty, "time_trial");
  assert.equal(resolveSpecialty({ existingSpecialities: ["classics"] }).primarySpecialty, "classics");
  assert.equal(resolveSpecialty({ existingSpecialities: ["all_rounder"] }).primarySpecialty, "all_rounder");
  assert.equal(resolveSpecialty({ existingSpecialities: ["domestique"] }).primarySpecialty, "domestique");
  // "leadout"/"breakaway" have no equivalent in this importer's output
  // vocabulary — reported as unknown for display, without touching the
  // underlying DB value (see the module doc comment).
  assert.equal(resolveSpecialty({ existingSpecialities: ["leadout"] }).primarySpecialty, "unknown");
  assert.equal(resolveSpecialty({ existingSpecialities: ["breakaway"] }).primarySpecialty, "unknown");
});

test("resolveSpecialty returns unknown/unknown with source 'unknown' when nothing exists yet", () => {
  assert.deepEqual(resolveSpecialty({ existingSpecialities: null }), {
    primarySpecialty: "unknown",
    secondarySpecialty: "unknown",
    specialtySource: "unknown",
  });
  assert.deepEqual(resolveSpecialty({ existingSpecialities: [] }), {
    primarySpecialty: "unknown",
    secondarySpecialty: "unknown",
    specialtySource: "unknown",
  });
  assert.deepEqual(resolveSpecialty({}), {
    primarySpecialty: "unknown",
    secondarySpecialty: "unknown",
    specialtySource: "unknown",
  });
});

test("SUPPORTED_SPECIALTIES and SPECIALTY_SOURCES are the documented closed vocabularies", () => {
  assert.deepEqual(SUPPORTED_SPECIALTIES, [
    "gc", "climber", "sprinter", "puncheur", "time_trial", "classics", "rouleur", "all_rounder", "domestique", "unknown",
  ]);
  assert.deepEqual(SPECIALTY_SOURCES, ["existing_supabase", "manual", "unknown"]);
});

test("every value resolveSpecialty can return is a member of SUPPORTED_SPECIALTIES", () => {
  const dbValues = ["gc", "sprint", "mountain", "time_trial", "classics", "all_rounder", "domestique", "leadout", "breakaway", null];
  for (const value of dbValues) {
    const result = resolveSpecialty({ existingSpecialities: value ? [value] : null });
    assert.ok(SUPPORTED_SPECIALTIES.includes(result.primarySpecialty), `${result.primarySpecialty} (from db value ${value}) must be in SUPPORTED_SPECIALTIES`);
    assert.ok(SPECIALTY_SOURCES.includes(result.specialtySource));
  }
});

test("youngRiderEligibilityCutoffDate is a fixed calendar date derived only from the race year", () => {
  assert.equal(youngRiderEligibilityCutoffDate(2026), "2001-01-01");
  assert.equal(youngRiderEligibilityCutoffDate(2023), "1998-01-01");
});

test("isYoungRiderEligible boundary: born exactly on the cutoff date is eligible", () => {
  assert.equal(isYoungRiderEligible("2001-01-01", 2026), true);
});

test("isYoungRiderEligible boundary: born one day before the cutoff is not eligible", () => {
  assert.equal(isYoungRiderEligible("2000-12-31", 2026), false);
});

test("isYoungRiderEligible returns null (not a guessed boolean) when date of birth is unknown", () => {
  assert.equal(isYoungRiderEligible(null, 2026), null);
  assert.equal(isYoungRiderEligible(undefined, 2026), null);
});

test("buildYoungRiderEligibility reports the rule source alongside the computed fields", () => {
  const result = buildYoungRiderEligibility("1998-09-21", 2026);
  assert.equal(result.young_rider_eligible, false);
  assert.equal(result.eligibility_cutoff_date, "2001-01-01");
  assert.match(result.eligibility_rule_source, /UCI\/ASO/);
});
