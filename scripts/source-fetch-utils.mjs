import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Shared fetch policy for this importer's two external sources
// (letour.fr, uci.org). Neither source is CyclingFantasy or
// procyclingstats.com — both were removed entirely (they return HTTP 403
// to automated requests and this project never attempts to bypass that
// kind of access restriction; see scripts/uci-client.mjs's
// module doc comment for the UCI investigation that replaced PCS as the
// source #2 enrichment provider).
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_ATTEMPTS = 4;
export const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
export const DEFAULT_MIN_REQUEST_INTERVAL_MS = 500;

export const IMPORTER_USER_AGENT =
  "GrandTourTippingBot/1.0 (+https://github.com/tmcstay/tipping; dry-run only; contact: tmcstay@gmail.com)";

export class SourceFetchError extends Error {
  constructor(message, { url, status = null, cause = null } = {}) {
    super(message);
    this.name = "SourceFetchError";
    this.url = url;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A tiny cooperative rate limiter: every call to `wait()` resolves only
 * once at least `minIntervalMs` has elapsed since the previous call
 * resolved. Never leaves a dangling timer past `wait()`'s own resolution
 * (no `setInterval`, no unref'd handle) so it can never be the reason a
 * short-lived Node process fails to exit.
 */
export function createRateLimiter(minIntervalMs = DEFAULT_MIN_REQUEST_INTERVAL_MS) {
  let nextAvailableAt = 0;
  return {
    async wait() {
      const now = Date.now();
      const waitMs = Math.max(0, nextAvailableAt - now);
      nextAvailableAt = Math.max(now, nextAvailableAt) + minIntervalMs;
      if (waitMs > 0) await sleep(waitMs);
    },
  };
}

/**
 * Fetches `url` with a hard request timeout (AbortController — always
 * cleared in a `finally`, so a completed or aborted request never leaves a
 * dangling timer behind) and retries on 429/5xx and on network errors, up
 * to `maxAttempts` total attempts, with linear backoff. A 4xx other than
 * 429 is never retried (it won't succeed on retry) and is reported via a
 * descriptive `SourceFetchError` carrying the real HTTP status.
 */
export async function fetchTextWithRetry(url, {
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  rateLimiter = null,
  headers = {},
  fetchImpl = fetch,
} = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (rateLimiter) await rateLimiter.wait();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { "User-Agent": IMPORTER_USER_AGENT, Accept: "text/html", ...headers },
        signal: controller.signal,
      });

      if (response.status === 429 || response.status >= 500) {
        lastError = new SourceFetchError(
          `${url} returned HTTP ${response.status} (attempt ${attempt}/${maxAttempts})`,
          { url, status: response.status },
        );
        if (attempt < maxAttempts) {
          await sleep(retryBaseDelayMs * attempt);
          continue;
        }
        throw lastError;
      }

      if (response.status === 403) {
        throw new SourceFetchError(
          `${url} returned HTTP 403 (access blocked). This importer never attempts to bypass access restrictions, CAPTCHAs, or bot protection — treat this source as unavailable for this run.`,
          { url, status: 403 },
        );
      }

      if (!response.ok) {
        throw new SourceFetchError(
          `${url} returned HTTP ${response.status} ${response.statusText}`,
          { url, status: response.status },
        );
      }

      return await response.text();
    } catch (error) {
      if (error instanceof SourceFetchError) throw error;
      const isAbort = error?.name === "AbortError";
      lastError = new SourceFetchError(
        isAbort
          ? `Timed out fetching ${url} after ${timeoutMs}ms (attempt ${attempt}/${maxAttempts})`
          : `Network error fetching ${url}: ${error.message} (attempt ${attempt}/${maxAttempts})`,
        { url, cause: error },
      );
      if (attempt < maxAttempts) {
        await sleep(retryBaseDelayMs * attempt);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new SourceFetchError(`Failed to fetch ${url}`, { url });
}

function cacheKeyForUrl(url) {
  return crypto.createHash("sha256").update(url).digest("hex");
}

/**
 * Disk cache for downloaded pages, keyed by URL hash. `--refresh-cache`
 * bypasses reads (still writes fresh results back). The cache directory is
 * created lazily and is expected to live under an ignored path (see
 * `.gitignore`'s `/tmp/` entry — callers should point this at
 * `tmp/tdf-2026-rider-importer-cache`).
 */
export function createPageCache(cacheDir, { refresh = false } = {}) {
  return {
    async read(url) {
      if (refresh) return null;
      try {
        const raw = await fs.readFile(path.join(cacheDir, `${cacheKeyForUrl(url)}.json`), "utf8");
        const parsed = JSON.parse(raw);
        return parsed.url === url ? parsed.body : null;
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    async write(url, body) {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(
        path.join(cacheDir, `${cacheKeyForUrl(url)}.json`),
        JSON.stringify({ url, fetchedAt: new Date().toISOString(), body }),
        "utf8",
      );
    },
  };
}

/**
 * Fetches through the cache: a cache hit never touches the network (no
 * rate-limit wait, no retry attempts); a cache miss fetches with retry and
 * then writes the result back. Cache read/write errors are never silently
 * swallowed as a fetch failure of the underlying page.
 */
export async function fetchTextCached(url, { cache, ...fetchOptions } = {}) {
  if (cache) {
    const cached = await cache.read(url);
    if (cached !== null) return { body: cached, fromCache: true };
  }
  const body = await fetchTextWithRetry(url, fetchOptions);
  if (cache) await cache.write(url, body);
  return { body, fromCache: false };
}

export const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 3;

/**
 * A per-provider circuit breaker: after `threshold` *consecutive*
 * access-denied responses (403/429 — the class of response this project
 * treats as "the site is blocking automated requests", not a transient
 * network blip), the breaker opens and stays open for the rest of this
 * process's run. Any other outcome (success, a timeout, a 5xx that's still
 * being retried by fetchTextWithRetry, a 404) resets the consecutive
 * counter — the breaker exists to stop hammering a source that has
 * started actively blocking us, not to penalize occasional failures.
 *
 * Deliberately has no reset/half-open retry timer: once open, a run never
 * re-probes the source — the whole point is "stop requesting further
 * profiles" for the remainder of *this* run (see the importer's UCI
 * circuit-breaker wiring), and a fresh process (the next scheduled/manual
 * run) starts with a fresh, closed breaker.
 */
export function createCircuitBreaker(threshold = DEFAULT_CIRCUIT_BREAKER_THRESHOLD) {
  let consecutiveAccessDeniedCount = 0;
  let open = false;
  let openedAt = null;
  let triggeringStatus = null;

  return {
    isOpen() {
      return open;
    },
    /** Call after a failed fetch attempt. `status` is the HTTP status if known (403/429), or null for a non-HTTP failure (timeout/network error), which never counts toward the breaker. */
    recordFailure(status) {
      if (status !== 403 && status !== 429) {
        consecutiveAccessDeniedCount = 0;
        return;
      }
      consecutiveAccessDeniedCount += 1;
      if (consecutiveAccessDeniedCount >= threshold && !open) {
        open = true;
        openedAt = new Date().toISOString();
        triggeringStatus = status;
      }
    },
    recordSuccess() {
      consecutiveAccessDeniedCount = 0;
    },
    getState() {
      return { open, consecutiveAccessDeniedCount, openedAt, triggeringStatus, threshold };
    },
  };
}
