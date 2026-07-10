const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canFinalise,
  canMarkChecked,
  canScore,
  formatGrandTourAdminActionMessage,
  getGrandTourAdminActionAvailability,
  getGrandTourAdminActionLabel
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
