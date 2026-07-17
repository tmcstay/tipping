import assert from "node:assert/strict";
import test from "node:test";

import {
  compressTeamHistoryToRanges,
  extractDataComponentProps,
  parseUciDate,
  parseUciRiderDetailsHtml,
  parseUciRiderSearchResponse,
  uciRiderIdFromUrl,
  uciRiderProfileUrl,
} from "./uci-parsers.mjs";

test("parseUciDate converts DD.MM.YYYY to ISO YYYY-MM-DD", () => {
  assert.equal(parseUciDate("21.09.1998"), "1998-09-21");
  assert.equal(parseUciDate("01.02.1999"), "1999-02-01");
});

test("parseUciDate returns null (never guesses) for an unrecognized format", () => {
  assert.equal(parseUciDate("1998-09-21"), null);
  assert.equal(parseUciDate(""), null);
  assert.equal(parseUciDate(null), null);
  assert.equal(parseUciDate(undefined), null);
  assert.equal(parseUciDate("garbage"), null);
});

test("uciRiderIdFromUrl extracts the numeric id from a /rider-details/<id> path", () => {
  assert.equal(uciRiderIdFromUrl("/rider-details/149727"), "149727");
  assert.equal(uciRiderIdFromUrl("https://www.uci.org/rider-details/149727"), "149727");
  assert.equal(uciRiderIdFromUrl("/team-details/21484"), null);
  assert.equal(uciRiderIdFromUrl(null), null);
});

test("uciRiderProfileUrl builds the canonical profile URL", () => {
  assert.equal(uciRiderProfileUrl("149727"), "https://www.uci.org/rider-details/149727");
});

// Modeled on the real JSON body returned by
// GET https://www.uci.org/api/riders/ROA/2026?page=1&search=Pogačar,
// confirmed live this session with a plain curl (200 OK, no auth).
const REAL_SEARCH_RESPONSE = JSON.stringify({
  totalItems: 1,
  page: 1,
  pageSize: 25,
  items: [
    { givenName: "Tadej", familyName: "POGAČAR", countryCode: "SLO", teamName: "UAE TEAM EMIRATES XRG (UEX)", url: "/rider-details/149727" },
  ],
});

test("parseUciRiderSearchResponse parses a real-shaped single-hit response", () => {
  const result = parseUciRiderSearchResponse(REAL_SEARCH_RESPONSE);
  assert.equal(result.totalItems, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].uciRiderId, "149727");
  assert.equal(result.items[0].familyName, "POGAČAR");
});

test("parseUciRiderSearchResponse handles a genuine zero-hit response", () => {
  const result = parseUciRiderSearchResponse(JSON.stringify({ totalItems: 0, page: 1, pageSize: 25, items: [] }));
  assert.equal(result.totalItems, 0);
  assert.deepEqual(result.items, []);
});

test("parseUciRiderSearchResponse throws a descriptive error on malformed JSON", () => {
  assert.throws(() => parseUciRiderSearchResponse("not json"), /not valid JSON/);
});

test("parseUciRiderSearchResponse throws a descriptive error when the shape is unexpected", () => {
  assert.throws(() => parseUciRiderSearchResponse(JSON.stringify({ foo: "bar" })), /items/);
});

test("extractDataComponentProps returns null when the named component is not on the page", () => {
  assert.equal(extractDataComponentProps("<html><body>nothing here</body></html>", "RiderDetailsModule"), null);
});

test("extractDataComponentProps throws when the component is present but its data-props is malformed", () => {
  const html = `<div data-component="RiderDetailsModule" data-props="{not valid json">`;
  assert.throws(() => extractDataComponentProps(html, "RiderDetailsModule"), /not valid JSON/);
});

test("compressTeamHistoryToRanges merges consecutive years at the same team into one range", () => {
  const teams = [
    { teamName: "UAE TEAM EMIRATES XRG", teamCode: "UEX", countryCode: "UAE", year: "2026" },
    { teamName: "UAE TEAM EMIRATES XRG", teamCode: "UAD", countryCode: "UAE", year: "2025" },
    { teamName: "UAE TEAM EMIRATES", teamCode: "UAD", countryCode: "UAE", year: "2024" },
    { teamName: "UAE TEAM EMIRATES", teamCode: "UAD", countryCode: "UAE", year: "2023" },
    { teamName: "ROG - LJUBLJANA", teamCode: "ROG", countryCode: "SLO", year: "2017" },
  ];
  const ranges = compressTeamHistoryToRanges(teams);
  assert.deepEqual(ranges, [
    { yearRange: "2026", teamName: "UAE TEAM EMIRATES XRG", teamCode: "UEX", countryCode: "UAE" },
    { yearRange: "2025", teamName: "UAE TEAM EMIRATES XRG", teamCode: "UAD", countryCode: "UAE" },
    { yearRange: "2023-2024", teamName: "UAE TEAM EMIRATES", teamCode: "UAD", countryCode: "UAE" },
    { yearRange: "2017", teamName: "ROG - LJUBLJANA", teamCode: "ROG", countryCode: "SLO" },
  ]);
});

test("compressTeamHistoryToRanges handles an empty/missing history without throwing", () => {
  assert.deepEqual(compressTeamHistoryToRanges([]), []);
  assert.deepEqual(compressTeamHistoryToRanges(undefined), []);
});

// Modeled on the real RiderDetailsModule data-props payload captured live
// this session from https://www.uci.org/rider-details/149727 (verified
// with a plain curl, 200 OK, no auth) — HTML-entity-encoded quotes and a
// JSON unicode escape for the diacritic, exactly as the live page renders
// it.
function uciRiderDetailsFixture() {
  return `<!doctype html><html><body>
<header></header>
<main role="main">
<div data-component="RiderDetailsModule" data-props="{&quot;details&quot;:{&quot;givenName&quot;:&quot;Tadej&quot;,&quot;familyName&quot;:&quot;POGA\\u010CAR&quot;,&quot;location&quot;:&quot;UAE TEAM EMIRATES XRG&quot;,&quot;dob&quot;:&quot;21.09.1998&quot;,&quot;nationality&quot;:&quot;SLO&quot;,&quot;sanctions&quot;:&quot;None&quot;},&quot;history&quot;:{&quot;title&quot;:&quot;Team History&quot;,&quot;teams&quot;:[{&quot;teamName&quot;:&quot;UAE TEAM EMIRATES XRG&quot;,&quot;teamCode&quot;:&quot;UEX&quot;,&quot;countryCode&quot;:&quot;UAE&quot;,&quot;url&quot;:&quot;/team-details/21484&quot;,&quot;year&quot;:&quot;2026&quot;},{&quot;teamName&quot;:&quot;UAE TEAM EMIRATES&quot;,&quot;teamCode&quot;:&quot;UAD&quot;,&quot;countryCode&quot;:&quot;UAE&quot;,&quot;url&quot;:&quot;/team-details/17729&quot;,&quot;year&quot;:&quot;2023&quot;}]}}"></div>
</main>
</body></html>`;
}

test("parseUciRiderDetailsHtml extracts DOB, nationality, current team, and team history from the real embedded JSON shape", () => {
  const profile = parseUciRiderDetailsHtml(uciRiderDetailsFixture(), { uciRiderId: "149727" });
  assert.equal(profile.canonicalName, "Tadej POGAČAR");
  assert.equal(profile.dateOfBirth, "1998-09-21");
  assert.equal(profile.dateOfBirthRaw, "21.09.1998");
  assert.equal(profile.nationality, "SLO");
  assert.equal(profile.currentTeam, "UAE TEAM EMIRATES XRG");
  assert.equal(profile.uciRiderId, "149727");
  assert.equal(profile.profileUrl, "https://www.uci.org/rider-details/149727");
  assert.equal(profile.teamHistory.length, 2);
  assert.equal(profile.teamHistory[0].teamCode, "UEX");
});

test("parseUciRiderDetailsHtml returns null (not a throw) when the page has no RiderDetailsModule at all", () => {
  assert.equal(parseUciRiderDetailsHtml("<html><body>not a rider page</body></html>", { uciRiderId: "1" }), null);
});

test("parseUciRiderDetailsHtml never bleeds one field's value into another (bounded JSON parse, not flattened-text scraping)", () => {
  // A rider whose team name happens to contain the substring "Nationality"
  // would break a flattened-text/regex-window parser but not a JSON one.
  const html = `<div data-component="RiderDetailsModule" data-props="{&quot;details&quot;:{&quot;givenName&quot;:&quot;Test&quot;,&quot;familyName&quot;:&quot;RIDER&quot;,&quot;location&quot;:&quot;Nationality Cycling Team&quot;,&quot;dob&quot;:&quot;01.02.1999&quot;,&quot;nationality&quot;:&quot;FRA&quot;,&quot;sanctions&quot;:&quot;None&quot;},&quot;history&quot;:{&quot;title&quot;:&quot;Team History&quot;,&quot;teams&quot;:[]}}">`;
  const profile = parseUciRiderDetailsHtml(html, { uciRiderId: "2" });
  assert.equal(profile.currentTeam, "Nationality Cycling Team");
  assert.equal(profile.nationality, "FRA");
  assert.equal(profile.dateOfBirth, "1999-02-01");
});
