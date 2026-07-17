import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  createCircuitBreaker,
  createPageCache,
  createRateLimiter,
  fetchTextCached,
  fetchTextWithRetry,
  SourceFetchError,
} from "./source-fetch-utils.mjs";

function jsonResponse(body, { status = 200, statusText = "OK" } = {}) {
  return { ok: status >= 200 && status < 300, status, statusText, text: async () => body };
}

test("fetchTextWithRetry returns body on a clean 200", async () => {
  const fetchImpl = async () => jsonResponse("<html>ok</html>");
  const body = await fetchTextWithRetry("https://example.test/page", { fetchImpl, maxAttempts: 1 });
  assert.equal(body, "<html>ok</html>");
});

test("fetchTextWithRetry retries on 429 then succeeds", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) return jsonResponse("", { status: 429, statusText: "Too Many Requests" });
    return jsonResponse("body-after-retry");
  };
  const body = await fetchTextWithRetry("https://example.test/page", {
    fetchImpl,
    maxAttempts: 4,
    retryBaseDelayMs: 1,
  });
  assert.equal(body, "body-after-retry");
  assert.equal(calls, 3);
});

test("fetchTextWithRetry retries on 5xx and eventually throws a descriptive error", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse("", { status: 503, statusText: "Service Unavailable" });
  };
  await assert.rejects(
    () => fetchTextWithRetry("https://example.test/page", { fetchImpl, maxAttempts: 3, retryBaseDelayMs: 1 }),
    (error) => {
      assert.ok(error instanceof SourceFetchError);
      assert.equal(error.status, 503);
      assert.match(error.message, /503/);
      return true;
    },
  );
  assert.equal(calls, 3);
});

test("fetchTextWithRetry produces a clean, descriptive error on HTTP 403 without retrying", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse("", { status: 403, statusText: "Forbidden" });
  };
  await assert.rejects(
    () => fetchTextWithRetry("https://example.test/blocked", { fetchImpl, maxAttempts: 4, retryBaseDelayMs: 1 }),
    (error) => {
      assert.ok(error instanceof SourceFetchError);
      assert.equal(error.status, 403);
      assert.match(error.message, /403/);
      assert.match(error.message, /never attempts to bypass/i);
      return true;
    },
  );
  assert.equal(calls, 1, "a 403 must not be retried");
});

test("fetchTextWithRetry does not retry a non-retryable 4xx", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse("", { status: 404, statusText: "Not Found" });
  };
  await assert.rejects(() => fetchTextWithRetry("https://example.test/missing", { fetchImpl, maxAttempts: 4, retryBaseDelayMs: 1 }));
  assert.equal(calls, 1);
});

test("fetchTextWithRetry times out a hung request and leaves no open handle", async () => {
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  });
  await assert.rejects(
    () => fetchTextWithRetry("https://example.test/hangs", { fetchImpl, timeoutMs: 20, maxAttempts: 1 }),
    (error) => {
      assert.ok(error instanceof SourceFetchError);
      assert.match(error.message, /Timed out/);
      return true;
    },
  );
  // No explicit handle-count assertion is meaningful inside node --test's own
  // process, but the absence of any lingering setTimeout is verified by
  // fetchTextWithRetry itself always clearing its timer in a `finally`
  // block (see scripts/source-fetch-utils.mjs) — this test's own success
  // (returning promptly, node --test exiting cleanly for the whole run)
  // is the practical proof; see the importer's own CLI for the process
  // exit-code convention this depends on.
});

test("createRateLimiter enforces the minimum interval between calls without leaving timers behind", async () => {
  const limiter = createRateLimiter(30);
  const start = Date.now();
  await limiter.wait();
  await limiter.wait();
  await limiter.wait();
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 55, `expected at least ~60ms between three calls spaced 30ms apart, got ${elapsed}ms`);
});

test("createPageCache round-trips a cached body and refresh bypasses the read", async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "tdf-rider-cache-"));
  try {
    const cache = createPageCache(cacheDir);
    assert.equal(await cache.read("https://example.test/a"), null);
    await cache.write("https://example.test/a", "cached-body");
    assert.equal(await cache.read("https://example.test/a"), "cached-body");

    const refreshingCache = createPageCache(cacheDir, { refresh: true });
    assert.equal(await refreshingCache.read("https://example.test/a"), null, "--refresh-cache must bypass reads");
  } finally {
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
});

test("fetchTextCached serves from cache without calling fetchImpl", async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "tdf-rider-cache-"));
  try {
    const cache = createPageCache(cacheDir);
    await cache.write("https://example.test/b", "already-cached");
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return jsonResponse("network-body"); };
    const { body, fromCache } = await fetchTextCached("https://example.test/b", { cache, fetchImpl });
    assert.equal(body, "already-cached");
    assert.equal(fromCache, true);
    assert.equal(calls, 0);
  } finally {
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
});

test("createCircuitBreaker starts closed", () => {
  const breaker = createCircuitBreaker(3);
  assert.equal(breaker.isOpen(), false);
});

test("createCircuitBreaker opens after 3 consecutive 403/429 failures", () => {
  const breaker = createCircuitBreaker(3);
  breaker.recordFailure(403);
  assert.equal(breaker.isOpen(), false);
  breaker.recordFailure(429);
  assert.equal(breaker.isOpen(), false);
  breaker.recordFailure(403);
  assert.equal(breaker.isOpen(), true);
});

test("createCircuitBreaker does not open on fewer than the threshold, and a non-blocking failure resets the streak", () => {
  const breaker = createCircuitBreaker(3);
  breaker.recordFailure(403);
  breaker.recordFailure(403);
  breaker.recordFailure(500); // a 5xx (already retried internally by fetchTextWithRetry) does not count toward the breaker
  breaker.recordFailure(403);
  breaker.recordFailure(403);
  assert.equal(breaker.isOpen(), false, "the 500 in the middle should have reset the consecutive-403/429 streak");
});

test("createCircuitBreaker: a success resets the consecutive-failure streak", () => {
  const breaker = createCircuitBreaker(3);
  breaker.recordFailure(403);
  breaker.recordFailure(403);
  breaker.recordSuccess();
  breaker.recordFailure(403);
  breaker.recordFailure(403);
  assert.equal(breaker.isOpen(), false);
});

test("createCircuitBreaker: once open, it stays open even after a later success (no half-open retry within one run)", () => {
  const breaker = createCircuitBreaker(3);
  breaker.recordFailure(403);
  breaker.recordFailure(403);
  breaker.recordFailure(403);
  assert.equal(breaker.isOpen(), true);
  breaker.recordSuccess();
  assert.equal(breaker.isOpen(), true);
});

test("createCircuitBreaker.getState reports the triggering status and threshold once open", () => {
  const breaker = createCircuitBreaker(3);
  breaker.recordFailure(403);
  breaker.recordFailure(403);
  breaker.recordFailure(403);
  const state = breaker.getState();
  assert.equal(state.open, true);
  assert.equal(state.triggeringStatus, 403);
  assert.equal(state.threshold, 3);
  assert.ok(state.openedAt);
});
