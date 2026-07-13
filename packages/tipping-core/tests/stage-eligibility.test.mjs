import assert from "node:assert/strict";
import test from "node:test";

import {
  isStageEligibleForResults,
  selectLatestEligibleStage
} from "../dist/stage-eligibility.js";

const NOW = new Date("2026-07-13T12:00:00.000Z");

test("a future stage is excluded from results", () => {
  assert.equal(
    isStageEligibleForResults({ startsAt: "2026-07-14T10:00:00Z", isFinal: true }, NOW),
    false
  );
});

test("a stage starting exactly now is not excluded solely as future", () => {
  assert.equal(
    isStageEligibleForResults({ startsAt: NOW.toISOString(), isFinal: true }, NOW),
    true
  );
});

test("a completed (finalised) stage is included in results", () => {
  assert.equal(
    isStageEligibleForResults({ startsAt: "2026-07-10T10:00:00Z", isFinal: true }, NOW),
    true
  );
});

test("a provisional-result stage is included once it has started", () => {
  assert.equal(
    isStageEligibleForResults(
      { startsAt: "2026-07-10T10:00:00Z", isFinal: false, reviewStatus: "review_required" },
      NOW
    ),
    true
  );
  for (const reviewStatus of ["imported", "admin_checked", "correction_required"]) {
    assert.equal(
      isStageEligibleForResults({ startsAt: "2026-07-10T10:00:00Z", reviewStatus }, NOW),
      true,
      `reviewStatus=${reviewStatus} should be eligible`
    );
  }
});

test("a future stage with an incorrectly populated result-like field remains excluded", () => {
  assert.equal(
    isStageEligibleForResults(
      { startsAt: "2026-07-14T10:00:00Z", isFinal: true, reviewStatus: "finalised" },
      NOW
    ),
    false
  );
});

test("a started stage with no result at all (or a bare draft) is not eligible - a stage row is never a result by itself", () => {
  assert.equal(isStageEligibleForResults({ startsAt: "2026-07-10T10:00:00Z" }, NOW), false);
  assert.equal(
    isStageEligibleForResults({ startsAt: "2026-07-10T10:00:00Z", isFinal: false, reviewStatus: "draft" }, NOW),
    false
  );
  assert.equal(
    isStageEligibleForResults({ startsAt: "2026-07-10T10:00:00Z", isFinal: false, reviewStatus: null }, NOW),
    false
  );
});

test("a missing/unparsable startsAt is never eligible", () => {
  assert.equal(isStageEligibleForResults({ startsAt: null, isFinal: true }, NOW), false);
  assert.equal(isStageEligibleForResults({ startsAt: "not-a-date", isFinal: true }, NOW), false);
});

test("selectLatestEligibleStage ignores future stages entirely", () => {
  const candidates = [
    { stageNumber: 5, startsAt: "2026-07-10T10:00:00Z", isFinal: true },
    { stageNumber: 6, startsAt: "2026-07-14T10:00:00Z", isFinal: true } // future - must be ignored
  ];
  const latest = selectLatestEligibleStage(candidates, NOW);
  assert.equal(latest.stageNumber, 5);
});

test("selectLatestEligibleStage sorts by actual start time descending, not array order or stage_number alone", () => {
  const candidates = [
    { stageNumber: 3, startsAt: "2026-07-08T10:00:00Z", isFinal: true },
    { stageNumber: 5, startsAt: "2026-07-11T10:00:00Z", isFinal: true },
    { stageNumber: 4, startsAt: "2026-07-09T10:00:00Z", isFinal: true }
  ];
  const latest = selectLatestEligibleStage(candidates, NOW);
  assert.equal(latest.stageNumber, 5);
});

test("selectLatestEligibleStage tie-breaks equal start times by stage number descending, deterministically", () => {
  const candidates = [
    { stageNumber: 4, startsAt: "2026-07-09T10:00:00Z", isFinal: true },
    { stageNumber: 9, startsAt: "2026-07-09T10:00:00Z", isFinal: true }
  ];
  assert.equal(selectLatestEligibleStage(candidates, NOW).stageNumber, 9);
});

test("selectLatestEligibleStage returns null when nothing is eligible, never an arbitrary stage", () => {
  const candidates = [
    { stageNumber: 6, startsAt: "2026-07-14T10:00:00Z", isFinal: true },
    { stageNumber: 7, startsAt: "2026-07-10T10:00:00Z", isFinal: false, reviewStatus: "draft" }
  ];
  assert.equal(selectLatestEligibleStage(candidates, NOW), null);
});

test("the latest completed stage calculation ignores future stages even when they sort first in the input array", () => {
  const candidates = [
    { stageNumber: 20, startsAt: "2026-12-01T10:00:00Z", isFinal: true },
    { stageNumber: 5, startsAt: "2026-07-10T10:00:00Z", isFinal: true }
  ];
  assert.equal(selectLatestEligibleStage(candidates, NOW).stageNumber, 5);
});
