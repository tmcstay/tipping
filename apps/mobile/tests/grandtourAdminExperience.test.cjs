const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildMarkCheckedConfirmationMessage,
  canFinalise,
  canMarkChecked,
  canScore,
  formatGrandTourAdminActionMessage,
  getGrandTourAdminActionAvailability,
  getGrandTourAdminActionLabel,
  getStageReviewWarnings,
  isStageDataComplete,
  isTttStageType
} = require("../../../dist/mobile-tests/grandtourAdminExperience.js");

function baseSummary(overrides = {}) {
  return {
    isFinal: false,
    reviewStatus: "imported",
    resultLineCount: 10,
    jerseyHolderCount: 4,
    scoreCount: 0,
    ...overrides
  };
}

test("Mark Checked is enabled only when 10 lines + 4 jerseys + not final + zero scores", () => {
  assert.equal(canMarkChecked(baseSummary()), true);
  assert.equal(canMarkChecked(baseSummary({ resultLineCount: 9 })), false);
  assert.equal(canMarkChecked(baseSummary({ jerseyHolderCount: 3 })), false);
  assert.equal(canMarkChecked(baseSummary({ isFinal: true })), false);
  assert.equal(canMarkChecked(baseSummary({ scoreCount: 1 })), false);
});

test("Mark Checked does not depend on review_status", () => {
  assert.equal(canMarkChecked(baseSummary({ reviewStatus: "admin_checked" })), true);
  assert.equal(canMarkChecked(baseSummary({ reviewStatus: null })), true);
});

test("Finalise is enabled only when review_status=admin_checked, not final, zero scores", () => {
  assert.equal(canFinalise(baseSummary({ reviewStatus: "admin_checked" })), true);
  assert.equal(canFinalise(baseSummary({ reviewStatus: "imported" })), false);
  assert.equal(canFinalise(baseSummary({ reviewStatus: "admin_checked", isFinal: true })), false);
  assert.equal(canFinalise(baseSummary({ reviewStatus: "admin_checked", scoreCount: 1 })), false);
});

test("Score is enabled only when review_status=finalised and is_final=true", () => {
  assert.equal(canScore(baseSummary({ reviewStatus: "finalised", isFinal: true })), true);
  assert.equal(canScore(baseSummary({ reviewStatus: "finalised", isFinal: false })), false);
  assert.equal(canScore(baseSummary({ reviewStatus: "admin_checked", isFinal: true })), false);
});

test("Score does not require zero score rows (re-scoring an already-scored stage is a valid UI state)", () => {
  assert.equal(canScore(baseSummary({ reviewStatus: "finalised", isFinal: true, scoreCount: 5 })), true);
});

test("getGrandTourAdminActionAvailability returns all three gates together", () => {
  const availability = getGrandTourAdminActionAvailability(baseSummary());
  assert.deepEqual(availability, {
    "mark-checked": true,
    finalise: false,
    score: false
  });
});

test("getGrandTourAdminActionLabel returns the exact button labels", () => {
  assert.equal(getGrandTourAdminActionLabel("mark-checked"), "Mark Checked");
  assert.equal(getGrandTourAdminActionLabel("finalise"), "Finalise");
  assert.equal(getGrandTourAdminActionLabel("score"), "Score");
});

test("formatGrandTourAdminActionMessage reports the RPC's status field when present", () => {
  const message = formatGrandTourAdminActionMessage("mark-checked", 5, { status: "checked" });
  assert.equal(message, "Mark Checked succeeded for stage 5 (status: checked).");
});

test("formatGrandTourAdminActionMessage reports the tip count for score's numeric result", () => {
  const message = formatGrandTourAdminActionMessage("score", 5, 12);
  assert.equal(message, "Score succeeded for stage 5: 12 tip(s) scored.");
});

test("formatGrandTourAdminActionMessage falls back to a plain success message for an unrecognized shape", () => {
  const message = formatGrandTourAdminActionMessage("finalise", 5, null);
  assert.equal(message, "Finalise succeeded for stage 5.");
});

test("isStageDataComplete is true only at exactly 10 lines and 4 jerseys", () => {
  assert.equal(isStageDataComplete(baseSummary()), true);
  assert.equal(isStageDataComplete(baseSummary({ resultLineCount: 9 })), false);
  assert.equal(isStageDataComplete(baseSummary({ jerseyHolderCount: 3 })), false);
  assert.equal(isStageDataComplete(baseSummary({ resultLineCount: 11, jerseyHolderCount: 5 })), false);
});

test("getStageReviewWarnings is empty when 10 lines + 4 jerseys are loaded", () => {
  assert.deepEqual(getStageReviewWarnings(baseSummary()), []);
});

test("getStageReviewWarnings reports missing lines and jerseys with exact counts", () => {
  const warnings = getStageReviewWarnings(baseSummary({ resultLineCount: 7, jerseyHolderCount: 2 }));
  assert.deepEqual(warnings, [
    "Only 7 of 10 result lines loaded.",
    "Only 2 of 4 jersey holders loaded."
  ]);
});

test("isTttStageType matches both real stage_type spellings and rejects everything else", () => {
  assert.equal(isTttStageType("ttt"), true);
  assert.equal(isTttStageType("team_time_trial"), true);
  assert.equal(isTttStageType("road"), false);
  assert.equal(isTttStageType("individual_time_trial"), false);
  assert.equal(isTttStageType(null), false);
  assert.equal(isTttStageType(undefined), false);
});

test("buildMarkCheckedConfirmationMessage includes the stage number and an ISO timestamp", () => {
  const now = new Date("2026-07-12T09:30:00.000Z");
  const message = buildMarkCheckedConfirmationMessage(5, now);
  assert.equal(
    message,
    "I have reviewed the top 10 result lines and four jersey holders for Stage 5, at 2026-07-12T09:30:00.000Z."
  );
});
