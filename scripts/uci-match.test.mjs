import assert from "node:assert/strict";
import test from "node:test";

import { pickBestUciMatch, scoreUciCandidate, stripUciTeamCodeSuffix } from "./uci-match.mjs";

function officialRider(overrides = {}) {
  return {
    officialName: "Tadej Pogacar",
    nationality: "SLO",
    teamName: "UAE Team Emirates - XRG",
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    givenName: "Tadej",
    familyName: "POGAČAR",
    countryCode: "SLO",
    teamName: "UAE TEAM EMIRATES XRG (UEX)",
    url: "/rider-details/149727",
    ...overrides,
  };
}

test("stripUciTeamCodeSuffix removes the trailing (CODE) UCI always appends", () => {
  assert.equal(stripUciTeamCodeSuffix("UAE TEAM EMIRATES XRG (UEX)"), "UAE TEAM EMIRATES XRG");
  assert.equal(stripUciTeamCodeSuffix("TEAM VISMA | LEASE A BIKE (TVL)"), "TEAM VISMA | LEASE A BIKE");
  assert.equal(stripUciTeamCodeSuffix("No Suffix Here"), "No Suffix Here");
});

test("scoreUciCandidate: exact name + nationality + team agreement is high confidence", () => {
  const result = scoreUciCandidate(officialRider(), candidate());
  assert.equal(result.confidence, "high");
  assert.ok(result.exactMatch);
  assert.ok(result.reasons.includes("nationality_agrees"));
  assert.ok(result.reasons.includes("team_agrees"));
});

test("scoreUciCandidate: alternate surname/given-name order still counts as a name match", () => {
  const altOrderCandidate = candidate({ givenName: "POGAČAR", familyName: "Tadej" });
  const result = scoreUciCandidate(officialRider(), altOrderCandidate);
  assert.ok(result.altOrderMatch);
  assert.equal(result.confidence, "high");
  assert.ok(result.reasons.includes("alternate_name_order_match"));
});

test("scoreUciCandidate: accent-insensitive comparison treats 'Pogacar' and 'POGAČAR' as the same name", () => {
  const result = scoreUciCandidate(officialRider({ officialName: "Tadej Pogacar" }), candidate({ familyName: "POGAČAR" }));
  assert.ok(result.exactMatch);
});

test("scoreUciCandidate: team-naming-convention variation (missing code suffix aside) still yields high confidence once stripped", () => {
  const result = scoreUciCandidate(
    officialRider({ teamName: "UAE Team Emirates XRG" }),
    candidate({ teamName: "UAE TEAM EMIRATES XRG (UEX)" }),
  );
  assert.equal(result.confidence, "high");
});

test("scoreUciCandidate: name+nationality match but team missing/different is medium confidence", () => {
  const result = scoreUciCandidate(officialRider(), candidate({ teamName: "SOME OTHER TEAM (SOT)" }));
  assert.equal(result.confidence, "medium");
  assert.ok(result.reasons.includes("team_differs_naming_convention"));
});

test("scoreUciCandidate: a name match with no team info at all is medium, not high", () => {
  const result = scoreUciCandidate(officialRider(), candidate({ teamName: null }));
  assert.equal(result.confidence, "medium");
  assert.ok(result.reasons.includes("team_missing"));
});

test("scoreUciCandidate: nationality conflict forces low confidence even with an exact name match", () => {
  const result = scoreUciCandidate(officialRider({ nationality: "SLO" }), candidate({ countryCode: "FRA" }));
  assert.equal(result.confidence, "low");
  assert.ok(result.reasons.includes("nationality_conflict"));
});

test("scoreUciCandidate: fuzzy name-only (no exact/alternate-order match) is low confidence", () => {
  const result = scoreUciCandidate(officialRider({ officialName: "Tadej Pogacar" }), candidate({ givenName: "Taj", familyName: "Pogacarov" }));
  assert.equal(result.confidence, "low");
  assert.ok(result.reasons.includes("fuzzy_name_match_only"));
});

test("scoreUciCandidate: a candidate whose current team reads as another discipline is rejected to low confidence even with a perfect name/nationality match", () => {
  const result = scoreUciCandidate(officialRider(), candidate({ teamName: "GREAT BRITAIN TRACK SQUAD (GBR)" }));
  assert.equal(result.confidence, "low");
  assert.ok(result.reasons.includes("team_suggests_non_road_discipline"));
});

test("pickBestUciMatch: a single high-confidence candidate is chosen", () => {
  const result = pickBestUciMatch(officialRider(), [candidate()]);
  assert.equal(result.confidence, "high");
  assert.equal(result.candidate.url, "/rider-details/149727");
});

test("pickBestUciMatch: never silently picks the first of multiple plausible candidates", () => {
  const twin1 = candidate({ url: "/rider-details/1", teamName: null });
  const twin2 = candidate({ url: "/rider-details/2", teamName: null });
  const result = pickBestUciMatch(officialRider(), [twin1, twin2]);
  assert.equal(result.candidate, null);
  assert.equal(result.confidence, "low");
  assert.equal(result.reasons[0], "multiple_plausible_candidates");
  assert.equal(result.candidates.length, 2);
});

test("pickBestUciMatch: zero candidates found is reported explicitly, not as a silent null", () => {
  const result = pickBestUciMatch(officialRider(), []);
  assert.equal(result.candidate, null);
  assert.equal(result.reasons[0], "no_candidates_found");
});

test("pickBestUciMatch: multiple low-confidence/ambiguous candidates stay unresolved rather than guessing", () => {
  const wrong1 = candidate({ url: "/rider-details/3", givenName: "Someone", familyName: "Else", countryCode: "FRA" });
  const wrong2 = candidate({ url: "/rider-details/4", givenName: "Another", familyName: "Person", countryCode: "BEL" });
  const result = pickBestUciMatch(officialRider(), [wrong1, wrong2]);
  assert.equal(result.candidate, null);
  assert.equal(result.confidence, "low");
  assert.equal(result.reasons[0], "multiple_ambiguous_low_confidence_candidates");
});

test("pickBestUciMatch: a lone low-confidence candidate is still surfaced (for review), not discarded", () => {
  const onlyOne = candidate({ countryCode: "FRA" });
  const result = pickBestUciMatch(officialRider({ nationality: "SLO" }), [onlyOne]);
  assert.equal(result.confidence, "low");
  assert.notEqual(result.candidate, null);
});
