const assert = require("node:assert/strict");
const test = require("node:test");

const { getMissingTipFields, buildTopFiveValidationMessage } = require("../../../dist/mobile-tests/tipEntryExperience.js");

test("road-stage missing fields identify rider positions only", () => {
  const messages = getMissingTipFields(["r1", "r2", null, "r4", "r5"], { green: "r2" }, false);
  assert.ok(messages.includes("Select your 3rd place rider."));
  assert.equal(messages.some((message) => message.includes("Jersey")), false);
});

test("TTT missing fields identify teams only", () => {
  const messages = getMissingTipFields(["t1", null, "t3", "t4", "t5"], {}, true);
  assert.ok(messages.includes("Select your 2nd team."));
  assert.equal(messages.some((message) => message.includes("Jersey")), false);
});

test("buildTopFiveValidationMessage: one concise line naming the remaining count, riders", () => {
  assert.equal(
    buildTopFiveValidationMessage([null, null, "r3", null, "r5"], false),
    "Select 3 more riders before submitting."
  );
});

test("buildTopFiveValidationMessage: singular wording for exactly one missing", () => {
  assert.equal(
    buildTopFiveValidationMessage(["r1", "r2", "r3", "r4", null], false),
    "Select 1 more rider before submitting."
  );
});

test("buildTopFiveValidationMessage: TTT uses 'team' wording", () => {
  assert.equal(
    buildTopFiveValidationMessage([null, "t2", "t3", "t4", "t5"], true),
    "Select 1 more team before submitting."
  );
});

test("buildTopFiveValidationMessage: complete top five shows the review message, never a per-row 'Missing' list", () => {
  const message = buildTopFiveValidationMessage(["r1", "r2", "r3", "r4", "r5"], false);
  assert.equal(message, "Your top five is complete. Review the order, then submit.");
  assert.ok(!message.includes("Missing"));
});
