import assert from "node:assert/strict";
import test from "node:test";

import { classifyProviderFailure, decideRetry, isStuckProcessing, MAX_SEND_ATTEMPTS } from "./retryPolicy.ts";

test("classifyProviderFailure: network failure (no status) is retryable", () => {
  assert.equal(classifyProviderFailure(null), "retryable");
});

test("classifyProviderFailure: 429 is retryable", () => {
  assert.equal(classifyProviderFailure(429), "retryable");
});

test("classifyProviderFailure: 5xx is retryable", () => {
  assert.equal(classifyProviderFailure(500), "retryable");
  assert.equal(classifyProviderFailure(503), "retryable");
});

test("classifyProviderFailure: 400/401/403/422 are permanent", () => {
  assert.equal(classifyProviderFailure(400), "permanent");
  assert.equal(classifyProviderFailure(401), "permanent");
  assert.equal(classifyProviderFailure(403), "permanent");
  assert.equal(classifyProviderFailure(422), "permanent");
});

test("decideRetry: permanent failure gives up immediately regardless of attempt count", () => {
  const now = new Date("2026-07-15T00:00:00Z");
  assert.deepEqual(decideRetry("permanent", 1, now), { action: "give_up" });
});

test("decideRetry: retryable failure #1 retries after 15 minutes", () => {
  const now = new Date("2026-07-15T00:00:00Z");
  const decision = decideRetry("retryable", 1, now);
  assert.equal(decision.action, "retry");
  if (decision.action === "retry") {
    assert.equal(decision.nextAttemptAt.toISOString(), "2026-07-15T00:15:00.000Z");
  }
});

test("decideRetry: retryable failure #2 retries after 60 minutes", () => {
  const now = new Date("2026-07-15T00:00:00Z");
  const decision = decideRetry("retryable", 2, now);
  assert.equal(decision.action, "retry");
  if (decision.action === "retry") {
    assert.equal(decision.nextAttemptAt.toISOString(), "2026-07-15T01:00:00.000Z");
  }
});

test("decideRetry: retryable failure #3 exhausts the budget and gives up", () => {
  const now = new Date("2026-07-15T00:00:00Z");
  assert.equal(MAX_SEND_ATTEMPTS, 3);
  assert.deepEqual(decideRetry("retryable", 3, now), { action: "give_up" });
});

test("isStuckProcessing: recently claimed job is not stuck", () => {
  const now = new Date("2026-07-15T00:05:00Z");
  const startedAt = new Date("2026-07-15T00:00:00Z");
  assert.equal(isStuckProcessing(startedAt, now), false);
});

test("isStuckProcessing: job claimed past the timeout is stuck", () => {
  const now = new Date("2026-07-15T00:11:00Z");
  const startedAt = new Date("2026-07-15T00:00:00Z");
  assert.equal(isStuckProcessing(startedAt, now), true);
});

test("isStuckProcessing: a job never claimed (null) is never stuck", () => {
  assert.equal(isStuckProcessing(null, new Date()), false);
});
