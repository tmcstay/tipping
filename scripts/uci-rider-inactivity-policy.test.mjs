import assert from "node:assert/strict";
import test from "node:test";

import {
  applyInactivityPolicy,
  INACTIVITY_THRESHOLD_CONSECUTIVE_SYNCS,
  recordRiderAbsent,
  recordRiderSeen,
} from "./uci-rider-inactivity-policy.mjs";

test("recordRiderSeen: refreshes last_seen_at, resets the absence counter, and reactivates the rider", () => {
  const now = new Date("2026-07-17T00:00:00Z");
  const result = recordRiderSeen({ now });
  assert.equal(result.last_seen_at, now.toISOString());
  assert.equal(result.consecutive_absences, 0);
  assert.equal(result.is_active, true);
});

test("recordRiderAbsent: a partial sync run never increments the absence counter (not evidence of absence)", () => {
  const result = recordRiderAbsent({ currentConsecutiveAbsences: 2, syncRunStatus: "partial" });
  assert.equal(result.changed, false);
  assert.equal(result.consecutive_absences, 2, "must be left completely untouched");
});

test("recordRiderAbsent: a failed sync run never increments the absence counter", () => {
  const result = recordRiderAbsent({ currentConsecutiveAbsences: 1, syncRunStatus: "failed" });
  assert.equal(result.changed, false);
  assert.equal(result.consecutive_absences, 1);
});

test("recordRiderAbsent: a completed sync run increments the counter by exactly 1", () => {
  const result = recordRiderAbsent({ currentConsecutiveAbsences: 1, syncRunStatus: "completed" });
  assert.equal(result.changed, true);
  assert.equal(result.consecutive_absences, 2);
  assert.equal(result.is_active, undefined, "below threshold: is_active must not be touched at all");
});

test("recordRiderAbsent: crossing the threshold on a completed run marks the rider inactive", () => {
  const result = recordRiderAbsent({ currentConsecutiveAbsences: INACTIVITY_THRESHOLD_CONSECUTIVE_SYNCS - 1, syncRunStatus: "completed" });
  assert.equal(result.consecutive_absences, INACTIVITY_THRESHOLD_CONSECUTIVE_SYNCS);
  assert.equal(result.is_active, false);
});

test("recordRiderAbsent: repeated completed-run absences eventually cross the threshold (simulated weekly syncs)", () => {
  let count = 0;
  let active;
  for (let i = 0; i < INACTIVITY_THRESHOLD_CONSECUTIVE_SYNCS; i += 1) {
    const outcome = recordRiderAbsent({ currentConsecutiveAbsences: count, syncRunStatus: "completed" });
    count = outcome.consecutive_absences;
    active = outcome.is_active;
  }
  assert.equal(count, INACTIVITY_THRESHOLD_CONSECUTIVE_SYNCS);
  assert.equal(active, false);
});

test("applyInactivityPolicy: seen this run always reactivates, regardless of prior absence count", () => {
  const patch = applyInactivityPolicy({ wasSeenThisRun: true, currentConsecutiveAbsences: 3, syncRunStatus: "completed" });
  assert.equal(patch.consecutive_absences, 0);
  assert.equal(patch.is_active, true);
});

test("applyInactivityPolicy: not seen, but this run was only partial -> no change at all, never a hard delete", () => {
  const patch = applyInactivityPolicy({ wasSeenThisRun: false, currentConsecutiveAbsences: 3, syncRunStatus: "partial" });
  assert.equal(patch.consecutive_absences, 3);
  assert.equal(patch.is_active, undefined);
});

test("applyInactivityPolicy: not seen on a completed run, still below threshold -> counter increments, is_active untouched", () => {
  const patch = applyInactivityPolicy({ wasSeenThisRun: false, currentConsecutiveAbsences: 0, syncRunStatus: "completed" });
  assert.equal(patch.consecutive_absences, 1);
  assert.equal(patch.is_active, undefined);
});
