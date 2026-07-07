import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOverallJerseySelections,
  buildStageTipSelections,
  buildTeamTimeTrialTipSelections,
  isCompleteOverallJerseyTip,
  isCompleteStageTip,
  isCompleteTeamTimeTrialTip,
  isTeamTimeTrialStageType
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

test("stage entries are complete with top five only while jersey competition is parked", () => {
  const selections = buildStageTipSelections(["r1", "r2", "r3", "r4", "r5"]);
  assert.equal(selections.length, 5);
  assert.equal(isCompleteStageTip(selections), true);
});

test("TTT entries are complete with team top five only while jersey competition is parked", () => {
  const selections = buildTeamTimeTrialTipSelections(["t1", "t2", "t3", "t4", "t5"]);
  assert.equal(selections.length, 5);
  assert.equal(isCompleteTeamTimeTrialTip(selections), true);
});

test("builds TTT Top 5 selections with teams and rider-only jerseys", () => {
  const selections = buildTeamTimeTrialTipSelections(
    ["t1", "t2", "t3", "t4", "t5"],
    { yellow_holder: "r1", green_holder: "r2", kom_holder: "r3", white_holder: "r4" }
  );
  const topFive = selections.filter((selection) => selection.selection_type === "stage_top_5");
  const jerseys = selections.filter((selection) => selection.selection_type !== "stage_top_5");

  assert.equal(isCompleteTeamTimeTrialTip(selections), true);
  assert.ok(topFive.every((selection) => selection.team_id && !selection.rider_id));
  assert.ok(jerseys.every((selection) => selection.rider_id && !selection.team_id));
  assert.equal(isCompleteStageTip(selections), false);
});

test("rejects duplicate teams in the TTT Top 5", () => {
  assert.throws(
    () => buildTeamTimeTrialTipSelections(["t1", "t2", "t1", null, null], {}),
    /five different teams/i
  );
});

test("normalizes both canonical TTT stage type values", () => {
  assert.equal(isTeamTimeTrialStageType("team_time_trial"), true);
  assert.equal(isTeamTimeTrialStageType("ttt"), true);
  assert.equal(isTeamTimeTrialStageType("road"), false);
});

test("rejects riders in a TTT Top 5", () => {
  const selections = buildTeamTimeTrialTipSelections(
    ["t1", "t2", "t3", "t4", "t5"],
    { yellow_holder: "r1", green_holder: "r2", kom_holder: "r3", white_holder: "r4" }
  );
  selections[0] = { selection_type: "stage_top_5", rider_id: "r9", predicted_position: 1 };
  assert.equal(isCompleteTeamTimeTrialTip(selections), false);
});

test("rejects teams in TTT jersey selections", () => {
  const selections = buildTeamTimeTrialTipSelections(
    ["t1", "t2", "t3", "t4", "t5"],
    { yellow_holder: "r1", green_holder: "r2", kom_holder: "r3", white_holder: "r4" }
  );
  const yellowIndex = selections.findIndex(({ selection_type }) => selection_type === "yellow_holder");
  selections[yellowIndex] = { selection_type: "yellow_holder", team_id: "t1" };
  assert.equal(isCompleteTeamTimeTrialTip(selections), false);
});

test("rejects teams in a road-stage Top 5", () => {
  const selections = buildStageTipSelections(
    ["r1", "r2", "r3", "r4", "r5"],
    { yellow_holder: "r1", green_holder: "r2", kom_holder: "r3", white_holder: "r4" }
  );
  selections[0] = { selection_type: "stage_top_5", team_id: "t1", predicted_position: 1 };
  assert.equal(isCompleteStageTip(selections), false);
});

test("rejects teams in road-stage jersey selections", () => {
  const selections = buildStageTipSelections(
    ["r1", "r2", "r3", "r4", "r5"],
    { yellow_holder: "r1", green_holder: "r2", kom_holder: "r3", white_holder: "r4" }
  );
  const yellowIndex = selections.findIndex(({ selection_type }) => selection_type === "yellow_holder");
  selections[yellowIndex] = { selection_type: "yellow_holder", team_id: "t1" };
  assert.equal(isCompleteStageTip(selections), false);
});
