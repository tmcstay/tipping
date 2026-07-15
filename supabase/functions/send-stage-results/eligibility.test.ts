import assert from "node:assert/strict";
import test from "node:test";

import { buildStageResultIdempotencyKey, classifyParticipant, isStageReadyForNotifications } from "./eligibility.ts";

test("isStageReadyForNotifications: final + scored is ready", () => {
  assert.equal(isStageReadyForNotifications({ isFinal: true, reviewStatus: "finalised", scoreCount: 12 }), true);
});

test("isStageReadyForNotifications: provisional (not final) is never ready", () => {
  assert.equal(isStageReadyForNotifications({ isFinal: false, reviewStatus: "imported", scoreCount: 0 }), false);
});

test("isStageReadyForNotifications: review_required is never ready even if somehow scored", () => {
  assert.equal(isStageReadyForNotifications({ isFinal: false, reviewStatus: "review_required", scoreCount: 5 }), false);
});

test("isStageReadyForNotifications: final but scoring not yet run is not ready", () => {
  assert.equal(isStageReadyForNotifications({ isFinal: true, reviewStatus: "finalised", scoreCount: 0 }), false);
});

test("isStageReadyForNotifications: correction_required (unfinalised for correction) is never ready", () => {
  assert.equal(isStageReadyForNotifications({ isFinal: false, reviewStatus: "correction_required", scoreCount: 8 }), false);
});

test("classifyParticipant: disabled preference is skipped with reason", () => {
  assert.deepEqual(classifyParticipant({ resultsEmailEnabled: false, email: "a@example.com" }), {
    status: "skipped",
    reason: "notifications_disabled",
  });
});

test("classifyParticipant: no usable email is skipped with reason, even if enabled", () => {
  assert.deepEqual(classifyParticipant({ resultsEmailEnabled: true, email: null }), {
    status: "skipped",
    reason: "no_email",
  });
  assert.deepEqual(classifyParticipant({ resultsEmailEnabled: true, email: "   " }), {
    status: "skipped",
    reason: "no_email",
  });
});

test("classifyParticipant: enabled + usable email is pending", () => {
  assert.deepEqual(classifyParticipant({ resultsEmailEnabled: true, email: "a@example.com" }), { status: "pending" });
});

test("buildStageResultIdempotencyKey matches the documented format", () => {
  assert.equal(buildStageResultIdempotencyKey("stage-1", "user-2"), "stage-result:stage-1:user-2");
});
