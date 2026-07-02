import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOverallJerseySelections,
  buildStageTipSelections,
  isCompleteOverallJerseyTip,
  isCompleteStageTip
} from "../dist/grandtour-entry.js";

test("builds five ordered riders and four daily jersey selections", () => {
  const selections = buildStageTipSelections(
    ["r1", "r2", "r3", "r4", "r5"],
    { yellow_holder: "r1", green_holder: "r1", kom_holder: "r6", white_holder: "r7" }
  );
  assert.equal(selections.length, 9);
  assert.deepEqual(
    selections.filter((selection) => selection.selection_type === "stage_top_5").map((selection) => selection.predicted_position),
    [1, 2, 3, 4, 5]
  );
  assert.equal(isCompleteStageTip(selections), true);
});

test("rejects duplicate riders in the ordered Top 5", () => {
  assert.throws(
    () => buildStageTipSelections(["r1", "r2", "r1", null, null], {}),
    /five different riders/i
  );
});

test("allows one rider across multiple jersey categories", () => {
  const selections = buildOverallJerseySelections({
    overall_yellow_winner: "r1",
    overall_green_winner: "r1",
    overall_kom_winner: "r1",
    overall_white_winner: "r1"
  });
  assert.equal(isCompleteOverallJerseyTip(selections), true);
  assert.equal(new Set(selections.map((selection) => selection.rider_id)).size, 1);
});

test("incomplete drafts remain valid to build but cannot be submitted", () => {
  const selections = buildStageTipSelections(["r1", null, null, null, null], {});
  assert.equal(selections.length, 1);
  assert.equal(isCompleteStageTip(selections), false);
});
