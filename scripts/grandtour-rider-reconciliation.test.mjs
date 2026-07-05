import assert from "node:assert/strict";
import test from "node:test";

import {
  planRiderReconciliation,
  stageSpecificBibPatch,
  summarizeRiderSource,
} from "./grandtour-rider-reconciliation.mjs";

const base = {
  grand_tour_id: "tour-1",
  team_id: "team-1",
  display_name: "Rider Name",
  normalized_name: "rider name",
  bib_number: 12,
  nationality: "AUS",
  country: "AUS",
};

test("matches exact normalized name within a tour and preserves the existing ID", () => {
  const plan = planRiderReconciliation(
    [{ ...base, id: "source-id" }],
    [{ ...base, id: "existing-id" }],
  );
  assert.equal(plan.records[0].row.id, "existing-id");
  assert.equal(plan.records[0].matchMethod, "normalized_name_and_tour");
  assert.equal(plan.summary.ridersSkipped, 1);
});

test("uses team and normalized name only to disambiguate exact-name candidates", () => {
  const plan = planRiderReconciliation(
    [{ ...base, id: "source-id", team_id: "team-2" }],
    [
      { ...base, id: "existing-1", team_id: "team-1" },
      { ...base, id: "existing-2", team_id: "team-2" },
    ],
  );
  assert.equal(plan.records[0].row.id, "existing-2");
  assert.equal(plan.records[0].matchMethod, "team_and_normalized_name");
});

test("reports ambiguous exact-name matches and never uses a partial-name fallback", () => {
  const ambiguous = planRiderReconciliation(
    [{ ...base, id: "source-id", team_id: null }],
    [
      { ...base, id: "existing-1", team_id: "team-1" },
      { ...base, id: "existing-2", team_id: "team-2" },
    ],
  );
  const partial = planRiderReconciliation(
    [{ ...base, id: "source-2", display_name: "Rider", normalized_name: "rider" }],
    [{ ...base, id: "existing-3" }],
  );
  assert.equal(ambiguous.summary.ambiguousMatches, 1);
  assert.equal(ambiguous.records[0].row, null);
  assert.equal(partial.summary.ridersInserted, 1);
});

test("rejects a stable rider ID collision across tours", () => {
  const plan = planRiderReconciliation(
    [{ ...base, id: "shared-id", grand_tour_id: "tour-1" }],
    [{ ...base, id: "shared-id", grand_tour_id: "tour-2" }],
  );
  assert.equal(plan.summary.ambiguousMatches, 1);
  assert.equal(plan.ambiguousMatches[0].reason, "stable_id_exists_in_another_tour");
});

test("reports conflicting populated values before update", () => {
  const plan = planRiderReconciliation(
    [{ ...base, id: "source-id", bib_number: 21, nationality: "FRA" }],
    [{ ...base, id: "existing-id" }],
  );
  assert.equal(plan.summary.ridersUpdated, 1);
  assert.deepEqual(
    plan.conflicts[0].fields.map(({ field }) => field).sort(),
    ["bib_number", "nationality"],
  );
});

test("summarizes missing and duplicate bib numbers per tour and team", () => {
  const summary = summarizeRiderSource([
    { ...base, id: "r1", bib_number: 12 },
    { ...base, id: "r2", bib_number: 12 },
    { ...base, id: "r3", bib_number: null },
    { ...base, id: "r4", bib_number: 12, team_id: "team-2" },
  ]);
  assert.equal(summary.missingBibNumbers, 1);
  assert.equal(summary.duplicateBibNumbersPerTourTeam.length, 1);
  assert.deepEqual(summary.duplicateBibNumbersPerTourTeam[0].riderIds, ["r1", "r2"]);
});

test("only patches startlist bibs from an explicit matching stage source", () => {
  assert.deepEqual(stageSpecificBibPatch({ bib_number: "12" }, "stage-1"), {});
  assert.deepEqual(
    stageSpecificBibPatch({ stage_id: "stage-1", bib_number: "34" }, "stage-1"),
    { bib_number: 34 },
  );
  assert.deepEqual(stageSpecificBibPatch({ stage_id: "stage-2", bib_number: "34" }, "stage-1"), {});
});
