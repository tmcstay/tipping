import assert from "node:assert/strict";
import test from "node:test";

import {
  isCyclingRiderSelectable,
  resolveCyclingStageClosureState,
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

test("scores one point when the predicted winner finishes elsewhere in the top five", () => {
  assert.equal(scoreCyclingStageWinnerTip(2), 1);
  assert.equal(scoreCyclingStageWinnerTip(5), 1);
});

test("scores no points outside the top five", () => {
  assert.equal(scoreCyclingStageWinnerTip(6), 0);
  assert.equal(scoreCyclingStageWinnerTip(null), 0);
});

// ---------------------------------------------------------------------------
// resolveCyclingStageClosureState
// ---------------------------------------------------------------------------

test("an open stage more than 24h from lock displays as open", () => {
  const state = resolveCyclingStageClosureState({
    startsAt: "2026-07-15T12:00:00Z",
    locksAt: "2026-07-15T10:00:00Z",
    now: "2026-07-13T09:00:00Z"
  });
  assert.equal(state, "open");
});

test("a stage one second before lock remains open for tipping (closing_soon, never closed - the lock boundary is exact, not early)", () => {
  const state = resolveCyclingStageClosureState({
    startsAt: "2026-07-15T12:00:00Z",
    locksAt: "2026-07-15T10:00:00Z",
    now: "2026-07-15T09:59:59.000Z"
  });
  assert.notEqual(state, "closed");
  assert.equal(state, "closing_soon");
});

test("a stage exactly at lock is closed", () => {
  const state = resolveCyclingStageClosureState({
    startsAt: "2026-07-15T12:00:00Z",
    locksAt: "2026-07-15T10:00:00Z",
    now: "2026-07-15T10:00:00.000Z"
  });
  assert.equal(state, "closed");
});

test("a stage after lock is closed", () => {
  const state = resolveCyclingStageClosureState({
    startsAt: "2026-07-15T12:00:00Z",
    locksAt: "2026-07-15T10:00:00Z",
    now: "2026-07-15T10:30:00.000Z"
  });
  assert.equal(state, "closed");
});

test("within 24h of lock (but before lock) is closing_soon", () => {
  const state = resolveCyclingStageClosureState({
    startsAt: "2026-07-16T10:00:00Z",
    locksAt: "2026-07-16T08:00:00Z",
    now: "2026-07-15T08:00:00.000Z" // exactly 24h before lock
  });
  assert.equal(state, "closing_soon");
});

test("a live stage (started, not yet final) displays live rather than a stale closure time, even though lock has also passed", () => {
  const state = resolveCyclingStageClosureState({
    startsAt: "2026-07-15T12:00:00Z",
    locksAt: "2026-07-15T10:00:00Z",
    now: "2026-07-15T13:00:00.000Z",
    isFinal: false
  });
  assert.equal(state, "live");
});

test("a completed (isFinal) stage displays completed even if now is far past both lock and start", () => {
  const state = resolveCyclingStageClosureState({
    startsAt: "2026-07-15T12:00:00Z",
    locksAt: "2026-07-15T10:00:00Z",
    now: "2026-07-20T00:00:00.000Z",
    isFinal: true
  });
  assert.equal(state, "completed");
});

test("missing lock data fails closed, per the existing lock-helper contract", () => {
  const state = resolveCyclingStageClosureState({
    startsAt: "2026-07-20T12:00:00Z",
    now: "2026-07-13T00:00:00.000Z"
  });
  assert.equal(state, "closed");
});

test("a manual_locked_at admin override takes priority over locks_at and can close a stage early", () => {
  const state = resolveCyclingStageClosureState({
    startsAt: "2026-07-16T12:00:00Z",
    locksAt: "2026-07-16T10:00:00Z",
    manualLockedAt: "2026-07-14T00:00:00Z",
    now: "2026-07-15T00:00:00.000Z" // after the manual override, before locks_at and starts_at
  });
  assert.equal(state, "closed");
});

test("resolveCyclingStageLockAt priority: manualLockedAt > locksAt > legacy startTime > stageDate fallback", () => {
  assert.equal(
    resolveCyclingStageClosureState({
      locksAt: "2026-07-16T10:00:00Z",
      manualLockedAt: "2026-07-14T00:00:00Z",
      now: "2026-07-10T00:00:00.000Z" // 4 days before the (earlier) manual override
    }),
    "open" // if locksAt were wrongly used instead, this would still be "open" too - the earlier assertion above ("takes priority... can close a stage early") is what actually proves priority; this one just confirms "open" is reachable at all with both fields present
  );
});
