const assert = require("node:assert/strict");
const test = require("node:test");

const {
  compareJerseyPicks,
  compareTopFiveWithResult,
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

test("compareTopFiveWithResult classifies exact, wrong-position-in-top5, outside-top-5, and not-picked", () => {
  const predicted = [
    { position: 1, riderId: "rider-a" }, // finished 1st: exact
    { position: 2, riderId: "rider-c" }, // finished 4th: top5-wrong-position
    { position: 3, riderId: "rider-z" }, // finished 9th: outside-top-5
    { position: 4, riderId: null },      // not picked
    { position: 5, riderId: "rider-b" }  // finished 2nd: top5-wrong-position
  ];
  const actual = [
    { position: 1, riderId: "rider-a" },
    { position: 2, riderId: "rider-b" },
    { position: 4, riderId: "rider-c" },
    { position: 9, riderId: "rider-z" }
  ];
  const result = compareTopFiveWithResult(predicted, actual);
  assert.deepEqual(result.map((r) => r.matchType), [
    "exact",
    "top5-wrong-position",
    "outside-top-5",
    "not-picked",
    "top5-wrong-position"
  ]);
  assert.equal(result[0].actualPosition, 1);
  assert.equal(result[3].actualPosition, null);
});

test("compareTopFiveWithResult ignores predictions outside positions 1-5 and sorts by position", () => {
  const predicted = [
    { position: 6, riderId: "rider-x" },
    { position: 2, riderId: "rider-b" },
    { position: 1, riderId: "rider-a" }
  ];
  const actual = [{ position: 1, riderId: "rider-a" }, { position: 2, riderId: "rider-b" }];
  const result = compareTopFiveWithResult(predicted, actual);
  assert.deepEqual(result.map((r) => r.predictedPosition), [1, 2]);
});

test("compareJerseyPicks classifies match, miss, not-picked, and pending", () => {
  const predicted = [
    { jerseyType: "yellow", riderId: "rider-a" },
    { jerseyType: "green", riderId: "rider-b" },
    { jerseyType: "kom", riderId: null },
    { jerseyType: "white", riderId: "rider-d" }
  ];
  const actual = [
    { jerseyType: "yellow", riderId: "rider-a" },
    { jerseyType: "green", riderId: "rider-x" }
  ];
  const result = compareJerseyPicks(predicted, actual);
  assert.deepEqual(result, [
    { jerseyType: "yellow", predictedRiderId: "rider-a", actualRiderId: "rider-a", matchType: "match" },
    { jerseyType: "green", predictedRiderId: "rider-b", actualRiderId: "rider-x", matchType: "miss" },
    { jerseyType: "kom", predictedRiderId: null, actualRiderId: null, matchType: "not-picked" },
    { jerseyType: "white", predictedRiderId: "rider-d", actualRiderId: null, matchType: "pending" }
  ]);
});
