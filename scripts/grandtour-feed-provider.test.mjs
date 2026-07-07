import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildFeedReview,
  parseFeedArgs,
  validateFeedPayload,
  ManualJsonGrandTourFeedProvider
} from "./grandtour-feed-provider.mjs";

test("dry-run feed import reports unmatched riders without mutating tables", () => {
  const review = buildFeedReview({
    mode: "dry-run",
    payload: {
      source_name: "manual-test",
      rider_statuses: [{ rider_name: "Unknown Rider", status: "withdrawn" }]
    }
  });

  assert.equal(review.summary.unmatchedRiders, 1);
  assert.equal(review.note.includes("does not mutate"), true);
});

test("rider status feed reports changed active/withdrawn states", () => {
  const review = buildFeedReview({
    mode: "dry-run",
    payload: {
      rider_statuses: [
        { rider_id: "r1", status: "active" },
        { rider_id: "r2", status: "withdrawn" }
      ]
    }
  });

  assert.equal(review.summary.changedRiderStatuses, 1);
});

test("stage result feed separates normal rider results from TTT team results", () => {
  const review = buildFeedReview({
    mode: "dry-run",
    payload: {
      stage_results: [{ stage_number: 2, type: "road", riders: [{ rider_id: "r1", position: 1 }] }],
      ttt_results: [{ stage_number: 1, type: "ttt", teams: [{ team_id: "t1", position: 1 }] }]
    }
  });

  assert.equal(review.summary.stageResultCandidates, 1);
  assert.equal(review.summary.tttResultCandidates, 1);
  assert.deepEqual(review.validationErrors, []);
});

test("feed validation rejects TTT rider placings", () => {
  assert.deepEqual(
    validateFeedPayload({ ttt_results: [{ stage_number: 1, type: "ttt", riders: [{ rider_id: "r1" }] }] }),
    ["TTT stage result must use teams, not rider placings."]
  );
});

test("import review includes source, fetched_at and validation outcome", () => {
  const review = buildFeedReview({
    mode: "dry-run",
    payload: {
      source_name: "manual-test",
      source_url: "https://example.test/feed.json",
      fetched_at: "2026-07-07T00:00:00.000Z"
    }
  });

  assert.equal(review.provider, "manual-test");
  assert.equal(review.sourceUrl, "https://example.test/feed.json");
  assert.equal(review.fetchedAt, "2026-07-07T00:00:00.000Z");
  assert.equal(review.importStatus, "validated");
});

test("dry-run with sample source file produces non-zero candidates", async () => {
  const samplePath = path.resolve("data", "feeds", "tdf-2026", "sample-stage-result.json");
  const provider = new ManualJsonGrandTourFeedProvider({ sourceFile: samplePath });
  const payload = await provider.readPayload();
  const review = buildFeedReview({ mode: "dry-run", payload });

  assert.equal(review.summary.stageResultCandidates, 1);
  assert.equal(review.summary.tttResultCandidates, 1);
  assert.equal(review.summary.changedRiderStatuses, 1);
  assert.deepEqual(review.validationErrors, []);
});

test("invalid source file reports validation errors", async () => {
  const invalidPayload = {
    source_name: "manual-invalid",
    ttt_results: [{ stage_number: 1, type: "ttt", riders: [{ rider_id: "r1" }] }]
  };
  const tempFile = path.resolve("tmp", "invalid-feed.json");
  await fs.mkdir(path.dirname(tempFile), { recursive: true });
  await fs.writeFile(tempFile, `${JSON.stringify(invalidPayload, null, 2)}\n`, "utf8");

  const provider = new ManualJsonGrandTourFeedProvider({ sourceFile: tempFile });
  const payload = await provider.readPayload();
  const review = buildFeedReview({ mode: "dry-run", payload });

  assert.equal(review.validationErrors.length, 1);
  assert.equal(review.validationErrors[0], "TTT stage result must use teams, not rider placings.");
});
