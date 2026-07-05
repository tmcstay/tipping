const assert = require("node:assert/strict");
const test = require("node:test");

const { getMissingTipFields } = require("../../../dist/mobile-tests/tipEntryExperience.js");

test("road-stage missing fields identify rider positions and jerseys", () => {
  const messages = getMissingTipFields(["r1", "r2", null, "r4", "r5"], { green: "r2" }, false);
  assert.ok(messages.includes("Select your 3rd place rider."));
  assert.ok(messages.includes("Select your Yellow Jersey rider."));
});

test("TTT missing fields identify teams while jerseys remain riders", () => {
  const messages = getMissingTipFields(["t1", null, "t3", "t4", "t5"], {}, true);
  assert.ok(messages.includes("Select your 2nd team."));
  assert.ok(messages.includes("Select your Yellow Jersey rider."));
});
