import assert from "node:assert/strict";
import test from "node:test";

import { planRiderSpecialtySync, SUPPORTED_SPECIALTIES } from "./uci-rider-specialty.mjs";

test("SUPPORTED_SPECIALTIES is re-exported unchanged from tdf-2026-rider-specialty.mjs (imported, not redefined)", () => {
  assert.ok(SUPPORTED_SPECIALTIES.includes("gc"));
  assert.ok(SUPPORTED_SPECIALTIES.includes("unknown"));
  assert.equal(SUPPORTED_SPECIALTIES.length, 10);
});

test("planRiderSpecialtySync: no existing row, no grand-tour specialities to preserve -> insert as unknown", () => {
  const result = planRiderSpecialtySync({ riderId: "r1", season: 2026 });
  assert.equal(result.action, "insert");
  assert.equal(result.row.primary_specialty, "unknown");
  assert.equal(result.row.source, "unknown");
});

test("planRiderSpecialtySync: preserves a trusted existing grandtour_riders specialities value", () => {
  const result = planRiderSpecialtySync({ riderId: "r1", season: 2026, existingGrandTourSpecialities: ["mountain"] });
  assert.equal(result.action, "insert");
  assert.equal(result.row.primary_specialty, "climber");
  assert.equal(result.row.source, "existing_supabase");
});

test("planRiderSpecialtySync: never infers a fresh specialty from UCI data -- there is no UCI input to this function at all", () => {
  // By construction this module accepts no UCI specialty signal
  // parameter whatsoever (UCI's payload has none) -- this test documents
  // that intent by confirming a call with only riderId/season produces
  // "unknown", never a guessed classification.
  const result = planRiderSpecialtySync({ riderId: "r1", season: 2026 });
  assert.equal(result.row.primary_specialty, "unknown");
});

test("planRiderSpecialtySync: an unchanged existing row (same primary/secondary/source) is left untouched", () => {
  const existingSpecialtyRow = { id: "spec-1", primary_specialty: "unknown", secondary_specialty: "unknown", source: "unknown", manually_reviewed: false };
  const result = planRiderSpecialtySync({ riderId: "r1", season: 2026, existingSpecialtyRow });
  assert.equal(result.action, "unchanged");
});

test("planRiderSpecialtySync: a genuinely different resolved specialty for an existing row becomes an update, keyed on the existing row id", () => {
  const existingSpecialtyRow = { id: "spec-1", primary_specialty: "unknown", secondary_specialty: "unknown", source: "unknown", manually_reviewed: false };
  const result = planRiderSpecialtySync({ riderId: "r1", season: 2026, existingSpecialtyRow, existingGrandTourSpecialities: ["sprint"] });
  assert.equal(result.action, "update");
  assert.equal(result.row.id, "spec-1");
  assert.equal(result.row.primary_specialty, "sprinter");
});

test("planRiderSpecialtySync: a manually_reviewed existing row is always preserved outright, never overwritten by a resync", () => {
  const existingSpecialtyRow = { id: "spec-1", primary_specialty: "climber", secondary_specialty: "unknown", source: "manual", manually_reviewed: true };
  const result = planRiderSpecialtySync({ riderId: "r1", season: 2026, existingSpecialtyRow, existingGrandTourSpecialities: ["sprint"] });
  assert.equal(result.action, "unchanged");
  assert.equal(result.row, existingSpecialtyRow);
  assert.equal(result.reason, "manually_reviewed_preserved");
});
