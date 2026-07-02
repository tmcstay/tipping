import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreGrandTourOverallJerseys,
  scoreGrandTourStageTip
} from "../dist/grandtour-scoring.js";

const exactTopFive = [1, 2, 3, 4, 5].map((position) => ({
  riderId: `rider-${position}`,
  position
}));

const jerseys = {
  yellow: "rider-1",
  green: "rider-2",
  kom: "rider-3",
  white: "rider-4"
};

test("scores exact top-five positions 10, 8, 6, 4, and 2", () => {
  const score = scoreGrandTourStageTip({
    status: "submitted",
    predictedTopFive: exactTopFive,
    actualTopFive: exactTopFive,
    predictedJerseys: {},
    actualJerseys: {},
    activeJerseys: []
  });

  assert.deepEqual(score.topFive.map(({ points }) => points), [10, 8, 6, 4, 2]);
  assert.equal(score.topFiveScore, 30);
});

test("scores one point for every actual top-five rider in the wrong position", () => {
  const rotated = [
    { riderId: "rider-2", position: 1 },
    { riderId: "rider-3", position: 2 },
    { riderId: "rider-4", position: 3 },
    { riderId: "rider-5", position: 4 },
    { riderId: "rider-1", position: 5 }
  ];
  const score = scoreGrandTourStageTip({
    status: "locked",
    predictedTopFive: rotated,
    actualTopFive: exactTopFive,
    predictedJerseys: {},
    actualJerseys: {},
    activeJerseys: []
  });

  assert.equal(score.topFiveScore, 5);
  assert.ok(score.topFive.every(({ points }) => points === 1));
});

test("scores zero when a predicted rider is outside the actual top five", () => {
  const predicted = exactTopFive.map((selection) => ({ ...selection }));
  predicted[4] = { riderId: "rider-outside", position: 5 };
  const score = scoreGrandTourStageTip({
    status: "submitted",
    predictedTopFive: predicted,
    actualTopFive: exactTopFive,
    predictedJerseys: {},
    actualJerseys: {},
    activeJerseys: []
  });

  assert.equal(score.topFive[4].points, 0);
});

test("scores five points for each correct daily jersey and a maximum stage score of 50", () => {
  const score = scoreGrandTourStageTip({
    status: "submitted",
    predictedTopFive: exactTopFive,
    actualTopFive: exactTopFive,
    predictedJerseys: jerseys,
    actualJerseys: jerseys
  });

  assert.equal(score.jerseyScore, 20);
  assert.equal(score.totalScore, 50);
});

test("scores 25 points for each correct overall jersey winner", () => {
  const score = scoreGrandTourOverallJerseys({
    status: "locked",
    predictedJerseys: jerseys,
    actualJerseys: jerseys
  });

  assert.equal(score.jerseyScore, 100);
  assert.equal(score.totalScore, 100);
});

test("an unsubmitted draft scores zero even when populated", () => {
  const stageScore = scoreGrandTourStageTip({
    status: "draft",
    predictedTopFive: exactTopFive,
    actualTopFive: exactTopFive,
    predictedJerseys: jerseys,
    actualJerseys: jerseys
  });
  const overallScore = scoreGrandTourOverallJerseys({
    status: "draft",
    predictedJerseys: jerseys,
    actualJerseys: jerseys
  });

  assert.equal(stageScore.totalScore, 0);
  assert.equal(overallScore.totalScore, 0);
});

test("supports competitions with a subset of active jerseys", () => {
  const score = scoreGrandTourStageTip({
    status: "submitted",
    predictedTopFive: exactTopFive,
    actualTopFive: exactTopFive,
    predictedJerseys: { yellow: "rider-1" },
    actualJerseys: { yellow: "rider-1" },
    activeJerseys: ["yellow"]
  });

  assert.equal(score.jerseyScore, 5);
  assert.equal(score.totalScore, 35);
});

test("rejects duplicate riders in a submitted top five", () => {
  const duplicate = exactTopFive.map((selection) => ({ ...selection }));
  duplicate[4] = { riderId: "rider-1", position: 5 };

  assert.throws(() => scoreGrandTourStageTip({
    status: "submitted",
    predictedTopFive: duplicate,
    actualTopFive: exactTopFive,
    predictedJerseys: {},
    actualJerseys: {},
    activeJerseys: []
  }), /duplicate riders/);
});

test("scored tips remain eligible for deterministic recalculation", () => {
  const score = scoreGrandTourStageTip({
    status: "scored",
    predictedTopFive: exactTopFive,
    actualTopFive: exactTopFive,
    predictedJerseys: {},
    actualJerseys: {},
    activeJerseys: []
  });

  assert.equal(score.totalScore, 30);
});
