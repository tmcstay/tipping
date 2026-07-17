import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRiderName } from "./tdf-data-utils.mjs";
import { dbNormalizedName, mergeDateOfBirth, mergeRiderField, mergeRiderRecord, planRiderImport } from "./tdf-2026-rider-match.mjs";

test("dbNormalizedName matches the database's own generated-column rule (lowercase + collapse whitespace, no accent stripping)", () => {
  assert.equal(dbNormalizedName("Étienne Caron"), "étienne caron");
  assert.equal(dbNormalizedName("  Tadej   Pogačar  "), "tadej pogačar");
});

test("dbNormalizedName intentionally differs from normalizeRiderName's accent-stripping behaviour", () => {
  assert.notEqual(dbNormalizedName("Étienne Caron"), normalizeRiderName("Étienne Caron"));
});

test("normalizeRiderName folds accents so 'Pogačar' and 'Pogacar' normalize identically", () => {
  assert.equal(normalizeRiderName("Tadej Pogačar"), normalizeRiderName("Tadej Pogacar"));
  assert.equal(normalizeRiderName("Tadej Pogačar"), "tadej pogacar");
});

test("normalizeRiderName folds combining-mark diacritics (é, ñ) via NFKD stripping", () => {
  assert.equal(normalizeRiderName("Rémi Cavagna"), "remi cavagna");
  assert.equal(normalizeRiderName("Iñigo Rodríguez"), "inigo rodriguez");
});

test("normalizeRiderName does not fold ø (a distinct codepoint, not a combining-mark decomposition) — a known, pre-existing limitation of this shared utility, not introduced here", () => {
  assert.notEqual(normalizeRiderName("Magnus Cort Nielsen"), normalizeRiderName("Magnus Cørt Nielsen"));
});

test("mergeRiderField preserves an existing value when the incoming value is null", () => {
  assert.equal(mergeRiderField("1998-09-21", null), "1998-09-21");
  assert.equal(mergeRiderField("1998-09-21", undefined), "1998-09-21");
  assert.equal(mergeRiderField("1998-09-21", ""), "1998-09-21");
});

test("mergeRiderField takes the incoming value when it is present, even overwriting an existing non-null value", () => {
  assert.equal(mergeRiderField("2000-01-01", "1998-09-21"), "1998-09-21");
});

test("mergeRiderField returns null (not undefined) when both are absent", () => {
  assert.equal(mergeRiderField(null, undefined), null);
  assert.equal(mergeRiderField(undefined, null), null);
});

test("mergeRiderRecord: an existing DOB is not overwritten by a null incoming DOB", () => {
  const existing = { id: "existing-1", display_name: "Tadej Pogačar", normalized_name: "tadej pogacar", date_of_birth: "1998-09-21", nationality: "SLO" };
  const incoming = { display_name: "Tadej Pogačar", normalized_name: "tadej pogacar", date_of_birth: null, nationality: "SLO" };
  const merged = mergeRiderRecord(existing, incoming);
  assert.equal(merged.row.date_of_birth, "1998-09-21");
  assert.equal(merged.dateOfBirthConflict, false);
  assert.equal(merged.dateOfBirthSource, "existing_supabase");
});

test("mergeDateOfBirth: only high/medium confidence may automatically populate an empty DOB", () => {
  assert.equal(mergeDateOfBirth({ existingDob: null, incomingDob: "1998-09-21", matchConfidence: "high" }).value, "1998-09-21");
  assert.equal(mergeDateOfBirth({ existingDob: null, incomingDob: "1998-09-21", matchConfidence: "medium" }).value, "1998-09-21");
  assert.equal(mergeDateOfBirth({ existingDob: null, incomingDob: "1998-09-21", matchConfidence: "low" }).value, null);
  assert.equal(mergeDateOfBirth({ existingDob: null, incomingDob: "1998-09-21", matchConfidence: undefined }).value, null);
});

test("mergeDateOfBirth: a low-confidence match never overwrites an existing DOB either", () => {
  const result = mergeDateOfBirth({ existingDob: "1998-09-21", incomingDob: "1999-01-01", matchConfidence: "low" });
  assert.equal(result.value, "1998-09-21");
  assert.equal(result.conflict, false);
  assert.equal(result.source, "existing_supabase");
});

test("mergeDateOfBirth: a genuine conflict (both present, both trusted-confidence, and different) preserves the existing value and flags the conflict", () => {
  const result = mergeDateOfBirth({ existingDob: "1998-09-21", incomingDob: "1998-09-20", matchConfidence: "high" });
  assert.equal(result.value, "1998-09-21");
  assert.equal(result.conflict, true);
  assert.equal(result.source, "existing_supabase");
});

test("mergeDateOfBirth: matching existing and incoming values is not a conflict", () => {
  const result = mergeDateOfBirth({ existingDob: "1998-09-21", incomingDob: "1998-09-21", matchConfidence: "high" });
  assert.equal(result.value, "1998-09-21");
  assert.equal(result.conflict, false);
});

test("mergeDateOfBirth: no existing value and no usable incoming value reports source 'unknown'", () => {
  const result = mergeDateOfBirth({ existingDob: null, incomingDob: null, matchConfidence: "high" });
  assert.equal(result.value, null);
  assert.equal(result.source, "unknown");
});

function rider(overrides = {}) {
  return {
    grand_tour_id: "gt-1",
    source_url: "https://www.letour.fr/en/rider/1/team/rider-one",
    bib_number: 1,
    team_id: "team-1",
    display_name: "Rider One",
    normalized_name: "rider one",
    nationality: "AUS",
    date_of_birth: null,
    status: null,
    data_confidence: "medium",
    specialities: null,
    ...overrides,
  };
}

test("planRiderImport matches an existing rider by external id (source_url) even if the name changed", () => {
  const incoming = rider({ display_name: "Rider One Renamed", normalized_name: "rider one renamed" });
  const existing = [{ id: "existing-1", source_url: incoming.source_url, normalized_name: "rider one" }];
  const plan = planRiderImport([incoming], existing);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].matchMethod, "external_id");
  assert.equal(plan.updates[0].existing.id, "existing-1");
});

test("planRiderImport falls back to normalized name when source_url does not match any existing row", () => {
  const incoming = rider({ source_url: "https://www.letour.fr/en/rider/999/team/rider-one" });
  const existing = [{ id: "existing-1", source_url: "https://www.letour.fr/en/rider/1/team/rider-one-old", normalized_name: "rider one" }];
  const plan = planRiderImport([incoming], existing);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].matchMethod, "normalized_name");
});

test("planRiderImport inserts a rider with no existing match", () => {
  const incoming = rider();
  const plan = planRiderImport([incoming], []);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.unresolved.length, 0);
});

test("planRiderImport reports an ambiguous normalized-name match as unresolved rather than guessing", () => {
  const incoming = rider({ source_url: null });
  const existing = [
    { id: "existing-1", source_url: null, normalized_name: "rider one" },
    { id: "existing-2", source_url: null, normalized_name: "rider one" },
  ];
  const plan = planRiderImport([incoming], existing);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.unresolved.length, 1);
  assert.equal(plan.unresolved[0].reason, "ambiguous_match");
  assert.equal(plan.duplicateMatches.length, 1);
});

test("planRiderImport never matches two incoming riders to the same existing row", () => {
  const existing = [{ id: "existing-1", source_url: null, normalized_name: "rider one" }];
  const incomingA = rider({ source_url: null });
  const incomingB = rider({ source_url: null, bib_number: 2 });
  const plan = planRiderImport([incomingA, incomingB], existing);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.unresolved.length, 1);
  assert.equal(plan.unresolved[0].reason, "existing_row_matched_more_than_once");
});

test("planRiderImport routes a rider with no display name to unresolved instead of inserting a broken row", () => {
  const incoming = rider({ display_name: null, normalized_name: null });
  const plan = planRiderImport([incoming], []);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.unresolved.length, 1);
  assert.equal(plan.unresolved[0].reason, "missing_required_fields");
});
