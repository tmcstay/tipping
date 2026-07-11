const assert = require("node:assert/strict");
const test = require("node:test");

const {
  computeCumulativeHistory,
  computeHistorySummary
} = require("../../../dist/mobile-tests/grandtourHistoryExperience.js");

function row(overrides = {}) {
  return {
    stageId: `stage-${overrides.stageNumber ?? 1}`,
    stageNumber: 1,
    totalScore: null,
    top5Score: null,
    jerseyScore: null,
    bonusScore: null,
    ...overrides
  };
}

test("computeCumulativeHistory sorts by stage number and accumulates only scored stages", () => {
  const rows = [
    row({ stageNumber: 2, totalScore: 20 }),
    row({ stageNumber: 1, totalScore: 10 }),
    row({ stageNumber: 3, totalScore: null }),
    row({ stageNumber: 4, totalScore: 15 })
  ];
  const result = computeCumulativeHistory(rows);
  assert.deepEqual(result.map((r) => r.stageNumber), [1, 2, 3, 4]);
  assert.deepEqual(result.map((r) => r.cumulativeTotal), [10, 30, 30, 45]);
  assert.equal(result[2].totalScore, null, "unscored stage's own totalScore stays null, not 0");
});

test("computeCumulativeHistory handles an all-unscored history", () => {
  const rows = [row({ stageNumber: 1 }), row({ stageNumber: 2 })];
  const result = computeCumulativeHistory(rows);
  assert.deepEqual(result.map((r) => r.cumulativeTotal), [0, 0]);
});

test("computeHistorySummary sums only scored stages and computes best/average", () => {
  const rows = [
    row({ stageNumber: 1, totalScore: 10, top5Score: 6, jerseyScore: 4, bonusScore: 0 }),
    row({ stageNumber: 2, totalScore: 30, top5Score: 20, jerseyScore: 10, bonusScore: 0 }),
    row({ stageNumber: 3, totalScore: null })
  ];
  const summary = computeHistorySummary(rows);
  assert.deepEqual(summary, {
    totalScore: 40,
    totalTop5: 26,
    totalJersey: 14,
    totalBonus: 0,
    scoredStages: 2,
    bestStageScore: 30,
    averageScore: 20
  });
});

test("computeHistorySummary returns nulls/zeros for no scored stages", () => {
  const summary = computeHistorySummary([row({ stageNumber: 1 })]);
  assert.deepEqual(summary, {
    totalScore: 0,
    totalTop5: 0,
    totalJersey: 0,
    totalBonus: 0,
    scoredStages: 0,
    bestStageScore: null,
    averageScore: null
  });
});

