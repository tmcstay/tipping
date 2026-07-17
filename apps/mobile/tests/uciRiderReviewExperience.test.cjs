const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildConfirmConfirmationMessage,
  buildQueueCountsLabel,
  canConfirmMatch,
  extractCandidateRiderIds,
  formatQueueStatusLabel,
  formatQueueTypeLabel
} = require("../../../dist/mobile-tests/uciRiderReviewExperience.js");

test("formatQueueTypeLabel: known values get a human label, unknown falls back to the raw value", () => {
  assert.equal(formatQueueTypeLabel("ambiguous_candidate"), "Ambiguous candidate");
  assert.equal(formatQueueTypeLabel("unmatched_startlist_rider"), "Unmatched rider");
  assert.equal(formatQueueTypeLabel("some_future_type"), "some_future_type");
  assert.equal(formatQueueTypeLabel(null), "Unknown");
});

test("formatQueueStatusLabel: known values get a human label, unknown falls back to the raw value", () => {
  assert.equal(formatQueueStatusLabel("pending"), "Pending");
  assert.equal(formatQueueStatusLabel("new_rider_approved"), "New rider approved");
  assert.equal(formatQueueStatusLabel("something_else"), "something_else");
  assert.equal(formatQueueStatusLabel(undefined), "Unknown");
});

test("extractCandidateRiderIds: reads the item's own riderId column", () => {
  assert.deepEqual(extractCandidateRiderIds({ riderId: "uci-1", candidatePayload: null }), ["uci-1"]);
});

test("extractCandidateRiderIds: reads candidatePayload.evidence.candidateIds, deduplicated against riderId", () => {
  const item = { riderId: "uci-1", candidatePayload: { evidence: { candidateIds: ["uci-1", "uci-2"] } } };
  assert.deepEqual(extractCandidateRiderIds(item), ["uci-1", "uci-2"]);
});

test("extractCandidateRiderIds: never throws on a malformed/missing payload shape", () => {
  assert.deepEqual(extractCandidateRiderIds(null), []);
  assert.deepEqual(extractCandidateRiderIds(undefined), []);
  assert.deepEqual(extractCandidateRiderIds({ riderId: null, candidatePayload: "not an object" }), []);
  assert.deepEqual(extractCandidateRiderIds({ riderId: null, candidatePayload: { evidence: "not an object" } }), []);
  assert.deepEqual(extractCandidateRiderIds({ riderId: null, candidatePayload: { evidence: { candidateIds: "not an array" } } }), []);
  assert.deepEqual(extractCandidateRiderIds({ riderId: null, candidatePayload: [1, 2, 3] }), []);
});

test("canConfirmMatch: enabled only when exactly one candidate is present", () => {
  assert.equal(canConfirmMatch({ riderId: "uci-1", candidatePayload: null }), true);
  assert.equal(canConfirmMatch({ riderId: null, candidatePayload: {} }), false);
  assert.equal(
    canConfirmMatch({ riderId: null, candidatePayload: { evidence: { candidateIds: ["uci-1", "uci-2"] } } }),
    false
  );
  assert.equal(canConfirmMatch(null), false);
});

test("buildConfirmConfirmationMessage: includes the review item id and an ISO timestamp", () => {
  const now = new Date("2026-07-17T12:00:00.000Z");
  const message = buildConfirmConfirmationMessage({ id: "queue-item-1" }, now);
  assert.match(message, /queue-item-1/);
  assert.match(message, /2026-07-17T12:00:00\.000Z/);
});

test("buildQueueCountsLabel: empty list", () => {
  assert.equal(buildQueueCountsLabel([]), "Nothing pending review.");
});

test("buildQueueCountsLabel: summarizes counts by queue type, most common first, alphabetical tiebreak", () => {
  const items = [
    { queueType: "ambiguous_candidate" },
    { queueType: "ambiguous_candidate" },
    { queueType: "unmatched_startlist_rider" },
    { queueType: "dob_conflict" }
  ];
  assert.equal(
    buildQueueCountsLabel(items),
    "4 pending · 2 ambiguous candidate, 1 date-of-birth conflict, 1 unmatched rider"
  );
});
