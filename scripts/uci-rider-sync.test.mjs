import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIncomingRegistryRecord,
  fetchAllUciListingPages,
  parseSyncArgs,
  runRosterSeed,
  shouldFetchUciProfile,
} from "./uci-rider-sync.mjs";

function fakeJsonResponse(body) {
  return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify(body) };
}

const FAKE_ANON_KEY = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.sig`;

function withEnv(vars, fn) {
  const previous = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  Object.assign(process.env, vars);
  return fn().finally(() => {
    for (const key of Object.keys(vars)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

/** A minimal chainable fake Supabase client -- every builder method returns
 * `this`, and awaiting it resolves based on which table was named. */
function fakeAnonClient(dataByTable) {
  return {
    from(table) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        in() { return builder; },
        then(resolve) { return resolve({ data: dataByTable[table] ?? [], error: null }); },
      };
      return builder;
    },
  };
}

/** Full-shaped 23-team/8-rider-per-team fixture (parseOfficialTourRidersHtml
 * enforces this exact count, matching the real Tour startlist) -- the
 * first team's first rider is the real, findable name for the test. */
function letourFullRosterHtml() {
  return "<section class=\"competitors\">"
    + "<h3 class=\"list__heading\"><a href=\"/en/team/UAD/uae\">UAE Team Emirates</a></h3><div class=\"list__box\">"
    + Array.from({ length: 8 }, (_, i) => `<span class="bib">${i + 1}</span><span class="runner"><span class="flag js-display-lazy" data-class="flag--slo"></span><a class="runner__link" href="/en/rider/${i + 1}">${i === 0 ? "Tadej Pogacar" : i === 1 ? "Nobody Findable" : `Filler Rider ${i}`}</a></span>`).join("")
    + "</div>"
    + Array.from({ length: 22 }, (_, teamIndex) => `<h3 class="list__heading"><a href="/en/team/T${teamIndex}/team${teamIndex}">Team ${teamIndex}</a></h3><div class="list__box">`
      + Array.from({ length: 8 }, (_, i) => `<span class="bib">${100 + teamIndex * 8 + i}</span><span class="runner"><span class="flag js-display-lazy" data-class="flag--fra"></span><a class="runner__link" href="/en/rider/${100 + teamIndex * 8 + i}">Rider ${100 + teamIndex * 8 + i}</a></span>`).join("")
      + "</div>").join("")
    + "</section>";
}

test("parseSyncArgs: defaults to a dry run against ROA/2026", () => {
  const options = parseSyncArgs([]);
  assert.equal(options.dryRun, true);
  assert.equal(options.apply, false);
  assert.equal(options.discipline, "ROA");
  assert.equal(options.year, 2026);
});

test("parseSyncArgs: --apply implies dryRun=false", () => {
  const options = parseSyncArgs(["--apply"]);
  assert.equal(options.apply, true);
  assert.equal(options.dryRun, false);
});

test("parseSyncArgs: --discipline/--year/--from-page/--to-page are parsed", () => {
  const options = parseSyncArgs(["--discipline", "MTB", "--year", "2027", "--from-page", "2", "--to-page", "4"]);
  assert.equal(options.discipline, "MTB");
  assert.equal(options.year, 2027);
  assert.equal(options.fromPage, 2);
  assert.equal(options.toPage, 4);
});

test("parseSyncArgs: an unknown flag throws a descriptive error", () => {
  assert.throws(() => parseSyncArgs(["--nonsense"]), /Unknown argument/);
});

test("fetchAllUciListingPages: paginates following the response's own totalItems/pageSize, never a hardcoded page count", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const page = Number(new URL(url).searchParams.get("page"));
    if (page === 1) {
      return fakeJsonResponse({ totalItems: 3, page: 1, pageSize: 2, items: [
        { givenName: "A", familyName: "One", countryCode: "AUS", teamName: "Team A", url: "/rider-details/1" },
        { givenName: "B", familyName: "Two", countryCode: "AUS", teamName: "Team B", url: "/rider-details/2" },
      ] });
    }
    return fakeJsonResponse({ totalItems: 3, page: 2, pageSize: 2, items: [
      { givenName: "C", familyName: "Three", countryCode: "AUS", teamName: "Team C", url: "/rider-details/3" },
    ] });
  };

  // categories: [] -- this test is about pagination, not the category
  // filter (see the dedicated category tests below), so it opts out of
  // the default per-category multiplication.
  const result = await fetchAllUciListingPages({ discipline: "ROA", year: 2026, fetchImpl, categories: [] });
  assert.equal(calls, 2, "must stop once totalItems is covered, never fetch a needless extra page");
  assert.equal(result.pagesRequested, 2);
  assert.equal(result.uniqueRidersReceived, 3);
  assert.equal(result.riders.length, 3);
});

test("fetchAllUciListingPages: dedupes a rider that appears on more than one page (by uciRiderId)", async () => {
  const fetchImpl = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    if (page === 1) {
      return fakeJsonResponse({ totalItems: 2, page: 1, pageSize: 1, items: [
        { givenName: "A", familyName: "One", url: "/rider-details/1" },
      ] });
    }
    return fakeJsonResponse({ totalItems: 2, page: 2, pageSize: 1, items: [
      { givenName: "A", familyName: "One", url: "/rider-details/1" },
    ] });
  };
  const result = await fetchAllUciListingPages({ discipline: "ROA", year: 2026, fetchImpl });
  assert.equal(result.uniqueRidersReceived, 1, "the same uciRiderId across two pages must be de-duplicated, not double-counted");
});

test("fetchAllUciListingPages: --from-page/--to-page bounds the range fetched", async () => {
  let requestedPages = [];
  const fetchImpl = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    requestedPages.push(page);
    return fakeJsonResponse({ totalItems: 100, page, pageSize: 1, items: [{ givenName: "X", familyName: String(page), url: `/rider-details/${page}` }] });
  };
  await fetchAllUciListingPages({ discipline: "ROA", year: 2026, fromPage: 3, toPage: 4, fetchImpl, categories: [] });
  assert.deepEqual(requestedPages, [3, 4]);
});

test("fetchAllUciListingPages: defaults to the men's-only categories (WTT/PRT/CTM), one full paginated crawl per category, merged", async () => {
  const requestedCategories = [];
  const idByCategory = { WTT: "1", PRT: "2", CTM: "3" };
  const fetchImpl = async (url) => {
    const category = new URL(url).searchParams.get("category");
    requestedCategories.push(category);
    // one distinct rider per category, single page each
    return fakeJsonResponse({
      totalItems: 1, page: 1, pageSize: 25,
      items: [{ givenName: category, familyName: "Rider", url: `/rider-details/${idByCategory[category]}` }],
    });
  };
  const result = await fetchAllUciListingPages({ discipline: "ROA", year: 2026, fetchImpl });
  assert.deepEqual(requestedCategories, ["WTT", "PRT", "CTM"]);
  assert.equal(result.uniqueRidersReceived, 3, "one distinct rider per category must all be kept, not collapsed");
  assert.equal(result.pagesRequested, 3);
});

test("fetchAllUciListingPages: category=[] issues the old unfiltered single crawl, no category param at all", async () => {
  const seenCategoryParams = [];
  const fetchImpl = async (url) => {
    seenCategoryParams.push(new URL(url).searchParams.get("category"));
    return fakeJsonResponse({ totalItems: 1, page: 1, pageSize: 25, items: [{ givenName: "A", familyName: "B", url: "/rider-details/1" }] });
  };
  await fetchAllUciListingPages({ discipline: "ROA", year: 2026, fetchImpl, categories: [] });
  assert.deepEqual(seenCategoryParams, [null]);
});

test("shouldFetchUciProfile: always fetches for a brand-new rider (no existing row)", () => {
  assert.equal(shouldFetchUciProfile({ givenName: "A" }, null), true);
});

test("shouldFetchUciProfile: always fetches when the existing row still has no DOB", () => {
  const existing = { given_name: "A", family_name: "B", nationality: "AUS", current_team_name: "Team A", date_of_birth: null };
  assert.equal(shouldFetchUciProfile({ givenName: "A", familyName: "B", countryCode: "AUS", teamName: "Team A" }, existing), true);
});

test("shouldFetchUciProfile: skips a re-fetch when nothing listing-visible changed and a DOB is already known", () => {
  const existing = { given_name: "A", family_name: "B", nationality: "AUS", current_team_name: "Team A", date_of_birth: "1998-01-01" };
  assert.equal(shouldFetchUciProfile({ givenName: "A", familyName: "B", countryCode: "AUS", teamName: "Team A" }, existing), false);
});

test("shouldFetchUciProfile: a changed team name still triggers a re-fetch even with a known DOB", () => {
  const existing = { given_name: "A", family_name: "B", nationality: "AUS", current_team_name: "Old Team", date_of_birth: "1998-01-01" };
  assert.equal(shouldFetchUciProfile({ givenName: "A", familyName: "B", countryCode: "AUS", teamName: "New Team" }, existing), true);
});

test("buildIncomingRegistryRecord: without a profile, uses listing-only data (no DOB)", () => {
  const record = buildIncomingRegistryRecord({ uciRiderId: "1", givenName: "A", familyName: "B", countryCode: "AUS", teamName: "Team A" }, null, { discipline: "ROA" });
  assert.equal(record.uciRiderId, "1");
  assert.equal(record.dateOfBirth, null);
  assert.equal(record.nationality, "AUS");
  assert.equal(record.discipline, "road");
});

test("buildIncomingRegistryRecord: with a fetched profile, profile fields take priority and matchConfidence is high (identity is already confirmed via uci_rider_id)", () => {
  const profile = { canonicalName: "A B", givenName: "A", familyName: "B", dateOfBirth: "1998-01-01", nationality: "AUS", currentTeam: "Team A", profileUrl: "https://www.uci.org/rider-details/1", teamHistoryRaw: [] };
  const record = buildIncomingRegistryRecord({ uciRiderId: "1", givenName: "A", familyName: "B" }, profile, { discipline: "ROA" });
  assert.equal(record.dateOfBirth, "1998-01-01");
  assert.equal(record.matchConfidence, "high");
  assert.equal(record.uciProfileUrl, "https://www.uci.org/rider-details/1");
});

test("buildIncomingRegistryRecord: an explicit matchConfidence overrides the 'high' default (the roster-seed path's search-based identity is not automatically as trusted as a direct listing lookup)", () => {
  const profile = { canonicalName: "A B", givenName: "A", familyName: "B", dateOfBirth: "1998-01-01", nationality: "AUS", currentTeam: "Team A", profileUrl: "https://www.uci.org/rider-details/1", teamHistoryRaw: [] };
  const record = buildIncomingRegistryRecord({ uciRiderId: "1", givenName: "A", familyName: "B" }, profile, { discipline: "ROA", matchConfidence: "medium" });
  assert.equal(record.matchConfidence, "medium");
});

test("runRosterSeed: rejects any --seed-from-roster value other than 'letour' (the only implemented adapter)", async () => {
  await assert.rejects(
    () => runRosterSeed({ seedFromRoster: "giro" }, {}),
    /only supports "letour"/,
  );
});

test("runRosterSeed: dry run finds a real-shaped high-confidence match by name for one entrant, and reports an unmatched entrant honestly rather than guessing", async () => {
  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: FAKE_ANON_KEY }, async () => {
    const html = letourFullRosterHtml();

    const fetchImpl = async (url) => {
      const href = String(url);
      if (href.includes("letour.fr")) return { ok: true, status: 200, statusText: "OK", text: async () => html };
      const query = new URL(href).searchParams.get("search");
      if (query && query.includes("Pogacar")) {
        return fakeJsonResponse({
          totalItems: 1, page: 1, pageSize: 25,
          items: [{ givenName: "Tadej", familyName: "Pogačar", countryCode: "SLO", teamName: "UAE Team Emirates", url: "/rider-details/149727" }],
        });
      }
      return fakeJsonResponse({ totalItems: 0, page: 1, pageSize: 25, items: [] });
    };

    const anonClient = fakeAnonClient({ uci_riders: [] });
    const result = await runRosterSeed(
      // --limit 2 keeps this test fast: only the fixture's first two
      // named riders (Tadej Pogacar, Nobody Findable) get processed --
      // the other 182 real-shaped filler entries would each still incur
      // the real UCI_MIN_REQUEST_INTERVAL_MS rate-limiter delay otherwise.
      { seedFromRoster: "letour", discipline: "ROA", year: 2026, categories: [], limit: 2, cacheDir: "tmp/uci-rider-sync-test-cache", refreshCache: true },
      { fetchImpl, createClient: () => anonClient },
    );

    assert.equal(result.summary.rosterEntriesConsidered, 2);
    assert.equal(result.registryPlan.inserts.length, 1, "the one findable rider should be planned as a registry insert");
    assert.equal(result.registryPlan.inserts[0].incoming.matchConfidence, "high");
    assert.equal(result.notFound.length, 1, "the unfindable roster entry is honestly reported, never guessed");
    assert.equal(result.notFound[0].officialName, "Nobody Findable");
    assert.equal(result.applyResult, null, "dry run must never call apply");
  });
});
