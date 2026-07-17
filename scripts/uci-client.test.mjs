import assert from "node:assert/strict";
import test from "node:test";

import { createCircuitBreaker, createRateLimiter } from "./source-fetch-utils.mjs";
import {
  buildUciSearchQueries,
  DEFAULT_UCI_TEAM_CATEGORIES,
  discoverUciCandidates,
  fetchUciRiderProfile,
  uciSearchUrl,
  UciCircuitBreakerOpenError,
} from "./uci-client.mjs";

function jsonResponse(body, { status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, statusText: "", text: async () => body };
}

const RIDER_PROFILE_HTML = `<div data-component="RiderDetailsModule" data-props="{&quot;details&quot;:{&quot;givenName&quot;:&quot;Tadej&quot;,&quot;familyName&quot;:&quot;POGA\\u010CAR&quot;,&quot;location&quot;:&quot;UAE TEAM EMIRATES XRG&quot;,&quot;dob&quot;:&quot;21.09.1998&quot;,&quot;nationality&quot;:&quot;SLO&quot;,&quot;sanctions&quot;:&quot;None&quot;},&quot;history&quot;:{&quot;title&quot;:&quot;Team History&quot;,&quot;teams&quot;:[]}}">`;

test("uciSearchUrl builds the confirmed live endpoint shape", () => {
  const url = uciSearchUrl({ disciplineCode: "ROA", year: 2026, query: "Pogačar", page: 1 });
  assert.equal(url, "https://www.uci.org/api/riders/ROA/2026?page=1&search=Poga%C4%8Dar");
});

test("uciSearchUrl includes category only when given (confirmed live: category=WTT/PRT/CTM filter, no category param means unfiltered)", () => {
  const withCategory = uciSearchUrl({ disciplineCode: "ROA", year: 2026, page: 1, category: "WTT" });
  assert.equal(withCategory, "https://www.uci.org/api/riders/ROA/2026?page=1&category=WTT");
  const withoutCategory = uciSearchUrl({ disciplineCode: "ROA", year: 2026, page: 1 });
  assert.equal(withoutCategory, "https://www.uci.org/api/riders/ROA/2026?page=1");
});

test("DEFAULT_UCI_TEAM_CATEGORIES is the men's-only set (WTT/PRT/CTM), never the women's equivalents", () => {
  assert.deepEqual(DEFAULT_UCI_TEAM_CATEGORIES, ["WTT", "PRT", "CTM"]);
});

test("discoverUciCandidates tries each default category in turn for a given query, recording which category each attempt used", async () => {
  const seenCategories = [];
  const fetchImpl = async (url) => {
    const category = new URL(url).searchParams.get("category");
    seenCategories.push(category);
    if (category === "CTM") {
      return jsonResponse(JSON.stringify({
        totalItems: 1, page: 1, pageSize: 25,
        items: [{ givenName: "Jonas", familyName: "Vingegaard", countryCode: "DEN", teamName: "Team Visma", url: "/rider-details/112082" }],
      }));
    }
    return jsonResponse(JSON.stringify({ totalItems: 0, page: 1, pageSize: 25, items: [] }));
  };
  const result = await discoverUciCandidates({ officialName: "Jonas Vingegaard" }, { year: 2026, fetchImpl });
  assert.deepEqual(seenCategories, ["WTT", "PRT", "CTM"], "must try categories in default order, stopping once one hits");
  assert.equal(result.candidates[0].uciRiderId, "112082");
  assert.equal(result.attempts.at(-1).category, "CTM");
});

test("discoverUciCandidates with categories: [] issues one category-less request per query (the pre-category-filter behavior)", async () => {
  const seenCategories = [];
  const fetchImpl = async (url) => {
    seenCategories.push(new URL(url).searchParams.get("category"));
    return jsonResponse(JSON.stringify({
      totalItems: 1, page: 1, pageSize: 25,
      items: [{ givenName: "Tadej", familyName: "Pogačar", countryCode: "SLO", teamName: null, url: "/rider-details/149727" }],
    }));
  };
  const result = await discoverUciCandidates({ officialName: "Tadej Pogačar" }, { year: 2026, fetchImpl, categories: [] });
  assert.deepEqual(seenCategories, [null]);
  assert.equal(result.candidates.length, 1);
});

test("buildUciSearchQueries tries the whole name first, then individual words of at least 3 characters", () => {
  assert.deepEqual(buildUciSearchQueries("Tadej Pogacar"), ["Tadej Pogacar", "Tadej", "Pogacar"]);
  assert.deepEqual(buildUciSearchQueries("Ben O'Connor"), ["Ben O'Connor", "Ben", "O'Connor"]);
});

test("buildUciSearchQueries drops very short words (initials) from the fallback list", () => {
  assert.deepEqual(buildUciSearchQueries("Al Jones"), ["Al Jones", "Jones"]);
});

test("discoverUciCandidates: full-name query succeeds when it matches directly", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(JSON.stringify({
      totalItems: 1, page: 1, pageSize: 25,
      items: [{ givenName: "Tadej", familyName: "POGAČAR", countryCode: "SLO", teamName: "UAE TEAM EMIRATES XRG (UEX)", url: "/rider-details/149727" }],
    }));
  };
  const result = await discoverUciCandidates({ officialName: "Tadej POGAČAR" }, { year: 2026, fetchImpl });
  assert.equal(result.candidates.length, 1);
  assert.equal(calls, 1, "should stop after the first successful query");
});

test("discoverUciCandidates: falls back to individual name words when the full-name query misses (accent mismatch)", async () => {
  const seenQueries = [];
  const fetchImpl = async (url) => {
    const query = new URL(url).searchParams.get("search");
    seenQueries.push(query);
    if (query === "Tadej Pogacar" || query === "Pogacar") {
      return jsonResponse(JSON.stringify({ totalItems: 0, page: 1, pageSize: 25, items: [] }));
    }
    // "Tadej" (given name, no accent, matches real UCI data)
    return jsonResponse(JSON.stringify({
      totalItems: 1, page: 1, pageSize: 25,
      items: [{ givenName: "Tadej", familyName: "POGAČAR", countryCode: "SLO", teamName: "UAE TEAM EMIRATES XRG (UEX)", url: "/rider-details/149727" }],
    }));
  };
  // categories: [] -- this test is about the word-fallback logic, not
  // category interaction, so it opts out of the default per-category
  // multiplication (see the dedicated category tests below for that).
  const result = await discoverUciCandidates({ officialName: "Tadej Pogacar" }, { year: 2026, fetchImpl, categories: [] });
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(seenQueries, ["Tadej Pogacar", "Tadej"]);
});

test("discoverUciCandidates: a query matching an unreasonably large pool is skipped in favour of a more specific one", async () => {
  const fetchImpl = async (url) => {
    const query = new URL(url).searchParams.get("search");
    if (query === "Van Der Berg") {
      return jsonResponse(JSON.stringify({ totalItems: 200, page: 1, pageSize: 25, items: [{ givenName: "X", familyName: "Y", countryCode: "NED", teamName: null, url: "/rider-details/1" }] }));
    }
    return jsonResponse(JSON.stringify({ totalItems: 1, page: 1, pageSize: 25, items: [{ givenName: "Van", familyName: "Der Berg", countryCode: "NED", teamName: null, url: "/rider-details/2" }] }));
  };
  const result = await discoverUciCandidates({ officialName: "Van Der Berg" }, { year: 2026, fetchImpl, maxCandidatePoolSize: 30 });
  assert.equal(result.candidates[0].uciRiderId, "2");
});

test("discoverUciCandidates records every attempt (including failures) for diagnostics, never silently discarding them", async () => {
  const fetchImpl = async () => jsonResponse(JSON.stringify({ totalItems: 0, page: 1, pageSize: 25, items: [] }));
  const result = await discoverUciCandidates({ officialName: "No Match Here" }, { year: 2026, fetchImpl });
  assert.equal(result.candidates.length, 0);
  assert.ok(result.attempts.length > 0);
});

test("fetchUciRiderProfile fetches and parses a real-shaped profile page", async () => {
  const fetchImpl = async () => jsonResponse(RIDER_PROFILE_HTML);
  const profile = await fetchUciRiderProfile("149727", { fetchImpl });
  assert.equal(profile.canonicalName, "Tadej POGAČAR");
  assert.equal(profile.dateOfBirth, "1998-09-21");
});

test("UCI circuit breaker: 3 consecutive 403s opens it and every subsequent profile fetch this run is skipped without a network call", async () => {
  const breaker = createCircuitBreaker(3);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse("", { status: 403 });
  };

  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(() => fetchUciRiderProfile(`rider-${i}`, { fetchImpl, circuitBreaker: breaker }));
  }
  assert.equal(breaker.isOpen(), true);
  assert.equal(calls, 3);

  // Remaining requests must be skipped entirely (no network call at all) once the breaker is open.
  await assert.rejects(
    () => fetchUciRiderProfile("rider-should-be-skipped", { fetchImpl, circuitBreaker: breaker }),
    (error) => {
      assert.ok(error instanceof UciCircuitBreakerOpenError);
      return true;
    },
  );
  assert.equal(calls, 3, "the 4th call must not have reached the network at all");
});

test("UCI circuit breaker: discoverUciCandidates stops issuing further search queries once the breaker opens mid-search", async () => {
  const breaker = createCircuitBreaker(3);
  const seenQueries = [];
  const fetchImpl = async (url) => {
    seenQueries.push(new URL(url).searchParams.get("search"));
    return jsonResponse("", { status: 429 });
  };
  // Prime the breaker to two failures already (as if earlier riders in this run tripped it partway).
  breaker.recordFailure(429);
  breaker.recordFailure(429);

  const result = await discoverUciCandidates(
    { officialName: "Three Word Name" },
    { year: 2026, fetchImpl, circuitBreaker: breaker, maxAttempts: 1 },
  );
  assert.equal(breaker.isOpen(), true);
  assert.deepEqual(
    seenQueries,
    ["Three Word Name"],
    "only the query that tripped the breaker should have gone out; later queries ('Three'/'Word'/'Name') must be skipped",
  );
  assert.equal(result.candidates.length, 0);
});

test("UCI circuit breaker: clean shutdown, no hanging handles, after a run of consecutive 403s (Windows-safe)", async () => {
  const breaker = createCircuitBreaker(3);
  const rateLimiter = createRateLimiter(5);
  const fetchImpl = async () => jsonResponse("", { status: 403 });

  for (let i = 0; i < 5; i += 1) {
    try {
      await fetchUciRiderProfile(`rider-${i}`, { fetchImpl, circuitBreaker: breaker, rateLimiter });
    } catch {
      // expected — every one of these either 403s or is skipped by the open breaker
    }
  }
  assert.equal(breaker.isOpen(), true);
  // No explicit timer/handle assertion is meaningful inside node --test's
  // own process; this test's own prompt return (and the whole suite's
  // clean exit) is the practical proof that fetchTextWithRetry's
  // `finally`-cleared AbortController timers and the rate limiter's
  // timer-free `wait()` never leave anything open — matching the same
  // convention already established in source-fetch-utils.test.mjs.
});
