import assert from "node:assert/strict";
import test from "node:test";

import {
  isCyclingRiderSelectable,
  scoreCyclingStageWinnerTip,
  validateCyclingStageWinnerTip
} from "../dist/cycling-stage-tip.js";

const unlockedStage = {
  startTime: "2026-07-04T12:00:00.000Z",
  now: "2026-07-04T11:59:59.000Z"
};

test("allows a provisional rider before the stage lock", () => {
  assert.equal(isCyclingRiderSelectable("provisional"), true);
  assert.deepEqual(
    validateCyclingStageWinnerTip({
      ...unlockedStage,
      riderStatus: "provisional"
    }),
    { valid: true, reason: null }
  );
});

test("blocks a withdrawn rider for a future stage", () => {
  assert.deepEqual(
    validateCyclingStageWinnerTip({
      ...unlockedStage,
      riderStatus: "withdrawn"
    }),
    { valid: false, reason: "rider_not_selectable" }
  );
});

test("prevents a duplicate stage-winner tip", () => {
  assert.deepEqual(
    validateCyclingStageWinnerTip({
      ...unlockedStage,
      hasExistingTip: true,
      riderStatus: "confirmed"
    }),
    { valid: false, reason: "duplicate_tip" }
  );
});

test("locks a tip at the stage start time", () => {
  assert.deepEqual(
    validateCyclingStageWinnerTip({
      now: "2026-07-04T12:00:00.000Z",
      riderStatus: "confirmed",
      startTime: "2026-07-04T12:00:00.000Z"
    }),
    { valid: false, reason: "stage_locked" }
  );
});

test("uses the configurable default lock time when stage start time is absent", () => {
  assert.deepEqual(
    validateCyclingStageWinnerTip({
      defaultLockTimeUtc: "14:30:00Z",
      now: "2026-07-04T14:29:59.000Z",
      riderStatus: "confirmed",
      stageDate: "2026-07-04"
    }),
    { valid: true, reason: null }
  );
});

test("scores an exact stage winner", () => {
  assert.equal(scoreCyclingStageWinnerTip(1), 10);
});

test("scores podium finishes", () => {
  assert.equal(scoreCyclingStageWinnerTip(2), 6);
  assert.equal(scoreCyclingStageWinnerTip(3), 4);
});

test("scores a top-ten finish", () => {
  assert.equal(scoreCyclingStageWinnerTip(10), 1);
});

test("scores no points outside the top ten", () => {
  assert.equal(scoreCyclingStageWinnerTip(11), 0);
  assert.equal(scoreCyclingStageWinnerTip(null), 0);
});
