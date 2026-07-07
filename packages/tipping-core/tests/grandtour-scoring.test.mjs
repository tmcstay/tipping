import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreGrandTourOverallJerseys,
  scoreGrandTourStageTip,
  scoreGrandTourTeamTimeTrialTip
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

const exactTeamTopFive = [1, 2, 3, 4, 5].map((position) => ({
  teamId: `team-${position}`,
  position
}));

const rotatedTeamTopFive = [
  { teamId: "team-2", position: 1 },
  { teamId: "team-3", position: 2 },
  { teamId: "team-4", position: 3 },
  { teamId: "team-5", position: 4 },
  { teamId: "team-1", position: 5 }
];

function scoreTtt(overrides = {}) {
  return scoreGrandTourTeamTimeTrialTip({
    status: "submitted",
    predictedTopFive: exactTeamTopFive,
    actualTopFive: exactTeamTopFive,
    predictedJerseys: jerseys,
    actualJerseys: jerseys,
    tttTimingRule: "individual_time",
    ...overrides
  });
}

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

test("missing parked stage jersey picks score zero without crashing", () => {
  const score = scoreGrandTourStageTip({
    status: "submitted",
    predictedTopFive: exactTopFive,
    actualTopFive: exactTopFive,
    predictedJerseys: {},
    actualJerseys: jerseys
  });

  assert.equal(score.topFiveScore, 30);
  assert.equal(score.jerseyScore, 0);
  assert.equal(score.totalScore, 30);
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

test("TTT exact team positions score six points each", () => {
  const score = scoreTtt({ activeJerseys: [] });

  assert.deepEqual(score.topFive.map(({ points }) => points), [6, 6, 6, 6, 6]);
  assert.equal(score.topFiveScore, 30);
});

test("TTT teams in the official top five at the wrong position score three points", () => {
  const score = scoreTtt({
    predictedTopFive: rotatedTeamTopFive,
    activeJerseys: []
  });

  assert.ok(score.topFive.every(({ points }) => points === 3));
  assert.equal(score.topFiveScore, 15);
});

test("TTT correct winning team earns the four-point winner bonus", () => {
  const score = scoreTtt({ activeJerseys: [] });

  assert.equal(score.winningTeamBonus, 4);
  assert.equal(score.teamStageScore, 34);
});

test("TTT yellow scoring uses the official individual yellow holder", () => {
  const score = scoreTtt({ activeJerseys: ["yellow"] });

  assert.equal(score.officialYellowHolderRiderId, "rider-1");
  assert.equal(score.jerseys[0].points, 5);
});

test("TTT winning-team pick does not award yellow points for a different rider", () => {
  const score = scoreTtt({
    predictedJerseys: { yellow: "rider-on-winning-team" },
    actualJerseys: { yellow: "official-yellow-rider" },
    activeJerseys: ["yellow"]
  });

  assert.equal(score.teamStageScore, 34);
  assert.equal(score.winningTeamBonus, 4);
  assert.equal(score.jerseyScore, 0);
});

test("TTT official yellow pick scores without a winning-team bonus", () => {
  const score = scoreTtt({
    predictedTopFive: rotatedTeamTopFive,
    predictedJerseys: { yellow: "official-yellow-rider" },
    actualJerseys: { yellow: "official-yellow-rider" },
    activeJerseys: ["yellow"]
  });

  assert.equal(score.winningTeamBonus, 0);
  assert.equal(score.jerseyScore, 5);
});

test("TTT missing official jersey results remain pending instead of resolved at zero", () => {
  const score = scoreTtt({ actualJerseys: {} });

  assert.equal(score.teamStageScore, 34);
  assert.equal(score.jerseyScore, 0);
  assert.equal(score.jerseyPending, true);
  assert.ok(score.jerseys.every(({ pending, points }) => pending && points === null));
});

test("TTT missing parked jersey picks do not block team scoring", () => {
  const score = scoreTtt({ predictedJerseys: {} });

  assert.equal(score.teamStageScore, 34);
  assert.equal(score.jerseyScore, 0);
  assert.equal(score.totalScore, 34);
});

test("TTT missing official team result does not score the team component", () => {
  const score = scoreTtt({ actualTopFive: null });

  assert.equal(score.teamResultPending, true);
  assert.equal(score.topFiveScore, 0);
  assert.equal(score.winningTeamBonus, 0);
  assert.equal(score.teamStageScore, 0);
  assert.ok(score.topFive.every(({ points }) => points === null));
});
