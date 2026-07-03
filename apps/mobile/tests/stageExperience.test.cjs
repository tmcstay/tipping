const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getStageTipExperience,
  TTT_RESULT_COPY,
  TTT_RESULT_SECTIONS,
  TTT_STAGE_TIP_COPY
} = require("../../../dist/mobile-tests/stageExperience.js");

test("TTT stage uses a team picker for the stage Top 5", () => {
  const experience = getStageTipExperience("team_time_trial");
  assert.equal(experience.isTtt, true);
  assert.equal(experience.topFivePicker, "team");
  assert.equal(experience.topFiveTitle, "Team Time Trial Top 5");
});

test("TTT stage keeps rider pickers for jerseys", () => {
  assert.equal(getStageTipExperience("ttt").jerseyPicker, "rider");
});

test("road stage keeps a rider picker for the stage Top 5", () => {
  const experience = getStageTipExperience("road");
  assert.equal(experience.isTtt, false);
  assert.equal(experience.topFivePicker, "rider");
  assert.equal(experience.topFiveTitle, "Ordered Top 5");
});

test("TTT result experience separates team and jersey results", () => {
  assert.deepEqual(TTT_RESULT_SECTIONS, ["Team Time Trial Result", "Jersey Results"]);
});

test("TTT explanatory copy remains exact", () => {
  assert.equal(
    TTT_STAGE_TIP_COPY,
    "Team Time Trial stage: pick the top 5 teams for the stage result. Jersey tips are still individual riders and are scored from the official jersey holders after the stage."
  );
  assert.equal(
    TTT_RESULT_COPY,
    "TTT stage points are scored against the official team result. Jersey points are scored against the official individual jersey holders after the stage."
  );
});
