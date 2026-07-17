import assert from "node:assert/strict";
import test from "node:test";

import {
  matchCanonicalRider,
  mergeCanonicalRiderRecord,
  mergeTrustedField,
  planRegistrySync,
  sourceContentHash,
} from "./uci-rider-registry.mjs";

function incomingRider(overrides = {}) {
  return {
    uciRiderId: "149727",
    uciCode: null,
    givenName: "Tadej",
    familyName: "Pogačar",
    displayName: "Tadej Pogačar",
    dateOfBirth: "1998-09-21",
    nationality: "SLO",
    gender: null,
    discipline: "road",
    currentTeamName: "UAE Team Emirates XRG",
    currentTeamCode: "UEX",
    uciProfileUrl: "https://www.uci.org/rider-details/149727",
    matchConfidence: "high",
    ...overrides,
  };
}

function existingRow(overrides = {}) {
  return {
    id: "existing-1",
    uci_rider_id: "149727",
    uci_code: null,
    given_name: "Tadej",
    family_name: "Pogačar",
    display_name: "Tadej Pogačar",
    normalized_name: "tadej pogacar",
    date_of_birth: "1998-09-21",
    nationality: "SLO",
    gender: null,
    discipline: "road",
    current_team_name: "UAE Team Emirates XRG",
    current_team_code: "UEX",
    uci_profile_url: "https://www.uci.org/rider-details/149727",
    is_active: true,
    manual_review_required: false,
    last_verified_at: null,
    data_confidence: "high",
    ...overrides,
  };
}

test("matchCanonicalRider: uci_rider_id is the primary, authoritative match", () => {
  const result = matchCanonicalRider(incomingRider(), [existingRow(), existingRow({ id: "other", uci_rider_id: "999" })]);
  assert.equal(result.match.id, "existing-1");
  assert.equal(result.matchMethod, "uci_rider_id");
  assert.equal(result.authoritative, true);
});

test("matchCanonicalRider: falls back to normalized_name when no uci_rider_id given, flagged non-authoritative", () => {
  const result = matchCanonicalRider(incomingRider({ uciRiderId: null }), [existingRow()]);
  assert.equal(result.match.id, "existing-1");
  assert.equal(result.matchMethod, "normalized_name");
  assert.equal(result.authoritative, false);
});

test("matchCanonicalRider: more than one existing row sharing a uci_rider_id is reported as duplicate_uci_identity, never guessed", () => {
  const result = matchCanonicalRider(incomingRider(), [existingRow({ id: "a" }), existingRow({ id: "b" })]);
  assert.equal(result.match, null);
  assert.equal(result.reason, "duplicate_uci_identity");
  assert.equal(result.ambiguousCandidates.length, 2);
});

test("matchCanonicalRider: more than one existing row sharing a name (no uci id) is ambiguous, never guessed", () => {
  const result = matchCanonicalRider(incomingRider({ uciRiderId: null }), [
    existingRow({ id: "a", uci_rider_id: null }),
    existingRow({ id: "b", uci_rider_id: null }),
  ]);
  assert.equal(result.match, null);
  assert.equal(result.reason, "ambiguous_name_match");
});

test("matchCanonicalRider: no candidates at all is a clean 'no match', not an error", () => {
  const result = matchCanonicalRider(incomingRider(), []);
  assert.equal(result.match, null);
  assert.deepEqual(result.ambiguousCandidates, []);
});

test("mergeTrustedField: DOB conflict keeps the trusted existing value and reports conflict", () => {
  const outcome = mergeTrustedField({ existingValue: "1998-09-21", incomingValue: "1999-01-01", incomingConfidence: "high" });
  assert.equal(outcome.value, "1998-09-21");
  assert.equal(outcome.conflict, true);
});

test("mergeTrustedField: low-confidence incoming value never populates an empty field", () => {
  const outcome = mergeTrustedField({ existingValue: null, incomingValue: "1999-01-01", incomingConfidence: "low" });
  assert.equal(outcome.value, null);
  assert.equal(outcome.conflict, false);
});

test("mergeTrustedField: high-confidence incoming value populates an empty field", () => {
  const outcome = mergeTrustedField({ existingValue: null, incomingValue: "1999-01-01", incomingConfidence: "high" });
  assert.equal(outcome.value, "1999-01-01");
  assert.equal(outcome.source, "uci");
});

test("mergeTrustedField: null-safe update never regresses an existing value with an incoming null", () => {
  const outcome = mergeTrustedField({ existingValue: "SLO", incomingValue: null, incomingConfidence: "high" });
  assert.equal(outcome.value, "SLO");
  assert.equal(outcome.conflict, false);
});

test("mergeTrustedField: a manually reviewed existing value is never overwritten, even by a high-confidence differing incoming value", () => {
  const outcome = mergeTrustedField({
    existingValue: "SLO",
    incomingValue: "AUS",
    incomingConfidence: "high",
    existingManuallyReviewed: true,
  });
  assert.equal(outcome.value, "SLO");
  assert.equal(outcome.conflict, true);
  assert.equal(outcome.source, "manual");
});

test("mergeCanonicalRiderRecord: brand-new rider populates every field", () => {
  const { row, dateOfBirthConflict, nationalityConflict } = mergeCanonicalRiderRecord(null, incomingRider());
  assert.equal(row.id, null);
  assert.equal(row.uci_rider_id, "149727");
  assert.equal(row.display_name, "Tadej Pogačar");
  assert.equal(row.normalized_name, "tadej pogacar");
  assert.equal(row.date_of_birth, "1998-09-21");
  assert.equal(dateOfBirthConflict, false);
  assert.equal(nationalityConflict, false);
});

test("sourceContentHash: identical inputs produce identical hashes; a changed field changes the hash", () => {
  const a = sourceContentHash({ uciRiderId: "1", displayName: "A" });
  const b = sourceContentHash({ uciRiderId: "1", displayName: "A" });
  const c = sourceContentHash({ uciRiderId: "1", displayName: "B" });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("planRegistrySync: an unchanged incoming record (identical to the existing row) produces zero writes", () => {
  const plan = planRegistrySync([incomingRider()], [existingRow()]);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.reviewItems.length, 0);
});

test("planRegistrySync: a genuinely new field value produces exactly one update", () => {
  const plan = planRegistrySync([incomingRider({ currentTeamName: "New Team" })], [existingRow()]);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].row.current_team_name, "New Team");
});

test("planRegistrySync: a brand-new rider (no existing match) is inserted", () => {
  const plan = planRegistrySync([incomingRider({ uciRiderId: "999999", displayName: "New Rider" })], [existingRow()]);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].row.uci_rider_id, "999999");
});

test("planRegistrySync: a DOB conflict is both reported in reviewItems and still applied as an update carrying the trusted existing value", () => {
  const plan = planRegistrySync([incomingRider({ dateOfBirth: "2001-01-01" })], [existingRow()]);
  assert.equal(plan.reviewItems.length, 1);
  assert.equal(plan.reviewItems[0].queueType, "dob_conflict");
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].row.date_of_birth, "1998-09-21", "the trusted existing DOB must be kept, not the conflicting incoming one");
});

test("planRegistrySync: two incoming records that would both match the same existing row is a duplicate-match review item, not a double-apply", () => {
  const plan = planRegistrySync([incomingRider(), incomingRider()], [existingRow()]);
  assert.equal(plan.reviewItems.filter((item) => item.queueType === "duplicate_uci_identity").length, 1);
});

test("planRegistrySync: two brand-new incoming records that both carry the same uci_rider_id (e.g. two roster entries independently name-searched to the same UCI identity) degrade to a review item, never a double insert (real bug found live: this crashed applyRegistryPlan's bulk insert on uci_riders' own unique constraint mid-batch)", () => {
  const plan = planRegistrySync(
    [
      incomingRider({ uciRiderId: "555555", displayName: "First Roster Name" }),
      incomingRider({ uciRiderId: "555555", displayName: "Second Roster Name" }),
    ],
    [],
  );
  assert.equal(plan.inserts.length, 1, "only the first occurrence is ever planned as an insert");
  assert.equal(plan.inserts[0].incoming.displayName, "First Roster Name");
  assert.equal(plan.reviewItems.filter((item) => item.queueType === "duplicate_uci_identity").length, 1);
  assert.equal(plan.reviewItems[0].incoming.displayName, "Second Roster Name");
});

test("planRegistrySync: an ambiguous match (name shared by two existing riders, no uci id) is routed to review, never guessed", () => {
  const plan = planRegistrySync(
    [incomingRider({ uciRiderId: null })],
    [existingRow({ id: "a", uci_rider_id: null }), existingRow({ id: "b", uci_rider_id: null })],
  );
  assert.equal(plan.reviewItems.length, 1);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, 0);
});
