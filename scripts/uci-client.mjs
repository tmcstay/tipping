// UCI public data surface — how this was discovered and verified.
//
// The task asked for the legitimate public endpoint the UCI site itself
// uses to search riders, without bypassing auth/CAPTCHA/Cloudflare or
// scraping search-engine result pages as the production mechanism. This
// was investigated (this session) as follows, in order:
//   1. `https://www.uci.org/robots.txt` — `Allow: /`, no restrictions.
//   2. Static HTML/bundle inspection of uci.org's "Road Riders/Teams"
//      page found an Algolia site-search widget
//      (`data-component="SearchOverlay"`, a public search-only API key —
//      Algolia search-only keys are designed to be exposed client-side,
//      this is not a credential leak) — but its index
//      (`uci-search-en-gb-master`) only contains CMS content
//      (`contentType`: page/news/event/resource, confirmed via a facet
//      query), never rider records. Ruled out as the rider-search
//      mechanism.
//   3. A rider-details page (`/rider-details/<id>`) was located via a
//      plain web search for a known rider's UCI profile purely to
//      discover the ID *format* for investigation (this project never
//      scrapes search-engine results as part of the importer itself —
//      see below); fetching it directly with a plain unauthenticated GET
//      returned 200 with the page's data already server-rendered,
//      including a clean embedded JSON payload (see
//      scripts/uci-parsers.mjs). No numeric ID can be derived
//      from a rider's name — it's an opaque UCI-assigned id.
//   4. A real Chromium session (Playwright, the same throwaway-install
//      convention already used elsewhere in this project for this exact
//      "need to see what the page's own JS actually requests" problem —
//      see CLAUDE.md's "Auth callback routing, part 3") loading the Road
//      Riders/Teams page captured the page's own outgoing requests. It
//      called `GET https://www.uci.org/api/riders/ROA/2026?page=1` — a
//      genuine first-party, unauthenticated, paginated JSON API that
//      backs the page's own visible rider list/search box. Confirmed
//      directly with a plain `curl` (no browser, no cookies, no
//      referrer needed) that this endpoint accepts a `search=` query
//      parameter and returns matching riders.
//
// **The mechanism**: `GET https://www.uci.org/api/riders/<disciplineCode>/<year>?page=<n>&search=<query>`
// — confirmed live against `disciplineCode=ROA` (road), `year=2026`:
//   - No authentication, no CAPTCHA, no Cloudflare challenge (plain GET,
//     200 OK).
//   - `search` performs a case-insensitive **substring** match against
//     `givenName`/`familyName` (both fields, not accent-folded) — e.g.
//     `search=Tadej` and `search=Vingegaard` both hit; `search=Pogacar`
//     (missing the real "Č") returns zero hits, while `search=Poga`
//     (the accent-free prefix) hits. This is why
//     `buildUciSearchQueries` below tries the whole name first and then
//     falls back to individual name words — letour.fr's own rendered
//     names are frequently ASCII-only (confirmed: the real letour page
//     renders "TADEJ POGACAR", no accent) even when UCI's own record has
//     the correct diacritic, so a single verbatim-name query alone would
//     silently miss a large fraction of real matches.
//   - Response: `{"totalItems":N,"page":1,"pageSize":25,"items":[{"givenName":...,"familyName":...,"countryCode":...,"teamName":...,"url":"/rider-details/<id>"}]}`.
// This is the "legitimate public endpoint used by the site to search
// riders" the task asked for.

import { createCircuitBreaker, fetchTextCached, SourceFetchError } from "./source-fetch-utils.mjs";
import { parseUciRiderDetailsHtml, parseUciRiderSearchResponse, uciRiderProfileUrl } from "./uci-parsers.mjs";

export const UCI_ROAD_DISCIPLINE_CODE = "ROA";
export const UCI_DEFAULT_MAX_CANDIDATE_POOL_SIZE = 30;

/**
 * UCI's own team-category vocabulary (confirmed live against the real API
 * -- see uciSearchUrl's `category` param below): WTT/WTW = WorldTeams
 * (men's/women's), PRT/PRW = ProTeams, CTM/CTW = Continental Teams, plus
 * an unfiltered "ALL CATEGORIES" option. This registry is scoped to men's
 * professional road racing -- WTT/PRT/CTM only, never the women's
 * equivalents -- per explicit product direction. `category` only accepts
 * ONE value per request (`category=WTT,PRT,CTM` returns 0 results,
 * confirmed live) -- callers that need all three issue one request per
 * category and merge, they never rely on this list being passable as a
 * single query value.
 */
export const DEFAULT_UCI_TEAM_CATEGORIES = ["WTT", "PRT", "CTM"];

export class UciCircuitBreakerOpenError extends Error {
  constructor(url) {
    super(`UCI circuit breaker is open; refusing to request ${url}. Too many consecutive 403/429 responses from uci.org this run.`);
    this.name = "UciCircuitBreakerOpenError";
    this.url = url;
  }
}

export function uciSearchUrl({ disciplineCode = UCI_ROAD_DISCIPLINE_CODE, year, query, page = 1, category }) {
  const params = new URLSearchParams({ page: String(page) });
  if (query) params.set("search", query);
  if (category) params.set("category", category);
  return `https://www.uci.org/api/riders/${disciplineCode}/${year}?${params.toString()}`;
}

/**
 * Splits an official Tour roster name into the query candidates UCI's
 * substring search should be tried against, in order: the whole name
 * first (works whenever there's no accent mismatch), then each
 * individual word of at least 3 characters (a short initial/particle
 * alone is too noisy to search on). See the module doc comment above for
 * why the whole-name query alone is not reliable.
 */
export function buildUciSearchQueries(officialName) {
  const trimmed = String(officialName ?? "").trim();
  const queries = trimmed ? [trimmed] : [];
  const words = trimmed.split(/\s+/).filter((word) => word.length >= 3);
  for (const word of words) {
    if (!queries.includes(word)) queries.push(word);
  }
  return queries;
}

async function fetchUciResource(url, { accept, cache, rateLimiter, circuitBreaker, fetchImpl, ...fetchOptions } = {}) {
  if (circuitBreaker?.isOpen()) {
    throw new UciCircuitBreakerOpenError(url);
  }
  try {
    const { body } = await fetchTextCached(url, {
      cache,
      rateLimiter,
      fetchImpl,
      headers: { Accept: accept },
      ...fetchOptions,
    });
    circuitBreaker?.recordSuccess();
    return body;
  } catch (error) {
    if (error instanceof SourceFetchError) circuitBreaker?.recordFailure(error.status);
    throw error;
  }
}

/**
 * Runs `buildUciSearchQueries` against the live search API, in order,
 * stopping at the first query that returns at least one hit within a
 * sane candidate-pool size (`maxCandidatePoolSize` — a query matching
 * dozens of riders is too generic to be useful and is skipped in favour
 * of a more specific later query, e.g. a family name, rather than
 * returned as-is). Each query is tried once per `categories` entry (default
 * `DEFAULT_UCI_TEAM_CATEGORIES` — men's WorldTeams/ProTeams/Continental
 * Teams only; a rider belongs to exactly one category at a time, so the
 * first category that hits wins and the rest are skipped for that query).
 * Returns `{ candidates, attempts, query }` — `attempts` records every
 * (query, category) pair tried (including failures), each tagged with its
 * category, for diagnostics/review, never silently discarded. If the
 * circuit breaker opens mid-search, the remaining attempts are skipped and
 * whatever was already found (possibly nothing) is returned — the caller
 * decides how to report that.
 */
export async function discoverUciCandidates(officialRider, {
  year,
  disciplineCode = UCI_ROAD_DISCIPLINE_CODE,
  categories = DEFAULT_UCI_TEAM_CATEGORIES,
  maxCandidatePoolSize = UCI_DEFAULT_MAX_CANDIDATE_POOL_SIZE,
  cache,
  rateLimiter,
  circuitBreaker,
  fetchImpl,
  ...fetchTuningOptions
} = {}) {
  const queries = buildUciSearchQueries(officialRider.officialName);
  const categoryList = categories && categories.length > 0 ? categories : [undefined];
  const attempts = [];

  for (const query of queries) {
    if (circuitBreaker?.isOpen()) break;
    for (const category of categoryList) {
      if (circuitBreaker?.isOpen()) break;
      const url = uciSearchUrl({ disciplineCode, year, query, page: 1, category });
      try {
        const body = await fetchUciResource(url, { accept: "application/json", cache, rateLimiter, circuitBreaker, fetchImpl, ...fetchTuningOptions });
        const parsed = parseUciRiderSearchResponse(body);
        attempts.push({ query, category: category ?? null, url, totalItems: parsed.totalItems, itemCount: parsed.items.length });
        if (parsed.items.length > 0 && parsed.totalItems <= maxCandidatePoolSize) {
          return { candidates: parsed.items, attempts, query };
        }
      } catch (error) {
        attempts.push({ query, category: category ?? null, url, error: error.message });
        if (circuitBreaker?.isOpen()) break;
      }
    }
  }

  return { candidates: [], attempts, query: null };
}

/**
 * Fetches and parses one rider's UCI profile page. Returns `null` (not an
 * error) when the page loaded but had no `RiderDetailsModule` on it — see
 * `parseUciRiderDetailsHtml`. Throws (a `SourceFetchError` or
 * `UciCircuitBreakerOpenError`) for a genuine fetch failure — the caller
 * is expected to catch that and record it, not let it crash the whole
 * import run.
 */
export async function fetchUciRiderProfile(uciRiderId, { cache, rateLimiter, circuitBreaker, fetchImpl, ...fetchTuningOptions } = {}) {
  const url = uciRiderProfileUrl(uciRiderId);
  const body = await fetchUciResource(url, { accept: "text/html", cache, rateLimiter, circuitBreaker, fetchImpl, ...fetchTuningOptions });
  return parseUciRiderDetailsHtml(body, { uciRiderId });
}

export { createCircuitBreaker };
