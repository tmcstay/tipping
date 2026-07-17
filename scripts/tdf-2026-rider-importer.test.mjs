import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIncomingRider,
  buildSourceSummary,
  parseImporterArgs,
  riderMatchesFilter,
  titleCaseName,
  toCsv,
} from "./tdf-2026-rider-importer.mjs";
import { planRiderImport } from "./tdf-2026-rider-match.mjs";

test("parseImporterArgs defaults to dry-run with no file writes, no apply, and UCI enabled", () => {
  const options = parseImporterArgs([]);
  assert.equal(options.dryRun, true);
  assert.equal(options.apply, false);
  assert.equal(options.writeCsv, false);
  assert.equal(options.refreshCache, false);
  assert.equal(options.limit, null);
  assert.equal(options.riderFilter, null);
  assert.equal(options.disableUci, false);
  assert.equal(options.uciId, null);
  assert.equal(options.uciSearchOnly, false);
});

test("parseImporterArgs: --apply turns off dry-run", () => {
  const options = parseImporterArgs(["--apply"]);
  assert.equal(options.apply, true);
  assert.equal(options.dryRun, false);
});

test("parseImporterArgs: --dry-run after --apply does not re-enable apply's opposite", () => {
  const options = parseImporterArgs(["--apply", "--dry-run"]);
  assert.equal(options.apply, true);
  assert.equal(options.dryRun, false);
});

test("parseImporterArgs parses --limit, --rider, --write-csv, --refresh-cache", () => {
  const options = parseImporterArgs(["--limit", "5", "--rider", "pogacar", "--write-csv", "--refresh-cache"]);
  assert.equal(options.limit, 5);
  assert.equal(options.riderFilter, "pogacar");
  assert.equal(options.writeCsv, true);
  assert.equal(options.refreshCache, true);
});

test("parseImporterArgs parses --disable-uci, --uci-id, --uci-search-only", () => {
  assert.equal(parseImporterArgs(["--disable-uci"]).disableUci, true);
  assert.equal(parseImporterArgs(["--uci-id", "149727"]).uciId, "149727");
  assert.equal(parseImporterArgs(["--uci-search-only"]).uciSearchOnly, true);
});

test("parseImporterArgs rejects --uci-id without a value", () => {
  assert.throws(() => parseImporterArgs(["--uci-id"]), /--uci-id requires/);
});

test("parseImporterArgs rejects an unknown flag with a descriptive error", () => {
  assert.throws(() => parseImporterArgs(["--bogus"]), /Unknown argument: --bogus/);
});

test("parseImporterArgs rejects --limit without a numeric value", () => {
  assert.throws(() => parseImporterArgs(["--limit"]), /--limit requires a number/);
  assert.throws(() => parseImporterArgs(["--limit", "abc"]), /--limit requires a number/);
});

test("titleCaseName title-cases an all-caps official name including hyphenated/apostrophe surnames", () => {
  assert.equal(titleCaseName("TADEJ POGAČAR"), "Tadej Pogačar");
  assert.equal(titleCaseName("VAN DER POEL Mathieu"), "Van Der Poel Mathieu");
  assert.equal(titleCaseName("O'CONNOR Ben"), "O'Connor Ben");
});

function letourRider(overrides = {}) {
  return {
    bib_number: 1,
    nationality: "SLO",
    profile_url: "https://www.letour.fr/en/rider/1/uae-team-emirates-xrg/tadej-pogacar",
    official_name: "Tadej Pogačar",
    ...overrides,
  };
}

function uciResult(overrides = {}) {
  return {
    candidate: { uciRiderId: "149727", givenName: "Tadej", familyName: "POGAČAR", countryCode: "SLO", teamName: "UAE TEAM EMIRATES XRG (UEX)", url: "/rider-details/149727" },
    confidence: "high",
    reasons: ["exact_name_match", "nationality_agrees", "team_agrees"],
    profile: {
      uciRiderId: "149727",
      profileUrl: "https://www.uci.org/rider-details/149727",
      canonicalName: "Tadej POGAČAR",
      dateOfBirth: "1998-09-21",
      nationality: "SLO",
      currentTeam: "UAE TEAM EMIRATES XRG",
      teamHistory: [{ yearRange: "2026", teamName: "UAE TEAM EMIRATES XRG", teamCode: "UEX", countryCode: "UAE" }],
    },
    ...overrides,
  };
}

test("buildIncomingRider prefers the UCI canonical name and DOB when a high-confidence match exists", () => {
  const incoming = buildIncomingRider({ letourRider: letourRider(), teamCode: "uad", teamId: "team-uuid-1", uciResult: uciResult(), grandTourId: "gt-1" });
  assert.equal(incoming.display_name, "Tadej Pogačar");
  assert.equal(incoming.date_of_birth, "1998-09-21");
  assert.equal(incoming.uci_rider_id, "149727");
  assert.equal(incoming.uci_match_confidence, "high");
  assert.equal(incoming.data_confidence, "high");
  assert.equal(incoming.uci_current_team, "UAE TEAM EMIRATES XRG");
  assert.equal(incoming.uci_team_history.length, 1);
  assert.equal(incoming.specialities, null, "this importer never computes a fresh specialty");
});

test("buildIncomingRider falls back to the letour official name (title-cased) when no UCI match exists", () => {
  const incoming = buildIncomingRider({ letourRider: letourRider({ official_name: "ISAAC DEL TORO" }), teamCode: "uad", teamId: "team-uuid-1", uciResult: null, grandTourId: "gt-1" });
  assert.equal(incoming.display_name, "Isaac Del Toro");
  assert.equal(incoming.date_of_birth, null);
  assert.equal(incoming.uci_match_confidence, null);
  assert.equal(incoming.data_confidence, "medium");
});

test("buildIncomingRider carries a low-confidence UCI DOB through as raw data (gating happens later, in the merge step)", () => {
  const incoming = buildIncomingRider({
    letourRider: letourRider(),
    teamCode: "uad",
    teamId: "team-uuid-1",
    uciResult: uciResult({ confidence: "low", reasons: ["fuzzy_name_match_only"] }),
    grandTourId: "gt-1",
  });
  assert.equal(incoming.date_of_birth, "1998-09-21");
  assert.equal(incoming.uci_match_confidence, "low");
  assert.equal(incoming.data_confidence, "medium");
});

test("riderMatchesFilter matches by bib number, normalized name substring, or UCI id", () => {
  const incoming = { bib_number: 1, normalized_name: "tadej pogacar", uci_rider_id: "149727", source_url: "https://www.letour.fr/en/rider/1/x/tadej-pogacar" };
  assert.equal(riderMatchesFilter(incoming, null), true);
  assert.equal(riderMatchesFilter(incoming, "1"), true);
  assert.equal(riderMatchesFilter(incoming, "pogacar"), true);
  assert.equal(riderMatchesFilter(incoming, "149727"), true);
  assert.equal(riderMatchesFilter(incoming, "999"), false);
});

test("toCsv escapes commas, quotes, and newlines, joins string-array fields with a pipe, and JSON-stringifies object-array fields", () => {
  const csv = toCsv(
    [{ name: 'Rider, "The Engine"', notes: "line1\nline2", tags: ["gc", "climber"], history: [{ year: "2026", teamName: "X" }] }],
    ["name", "notes", "tags", "history"],
  );
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "name,notes,tags,history");
  assert.ok(csv.includes('"Rider, ""The Engine"""'));
  assert.ok(csv.includes("gc|climber"));
  assert.ok(csv.includes("teamName"));
});

test("buildSourceSummary computes coverage/conflict/confidence counts from roster rows", () => {
  const rosterRows = [
    { date_of_birth: "1998-09-21", date_of_birth_source: "uci", dob_conflict: false, uci_match_confidence: "high", uci_match_reasons: ["exact_name_match", "nationality_agrees", "team_agrees"], uci_rider_id: "1", primary_specialty: "gc", young_rider_eligible: false },
    { date_of_birth: "1995-01-01", date_of_birth_source: "existing_supabase", dob_conflict: true, uci_match_confidence: "medium", uci_match_reasons: ["exact_name_match", "nationality_agrees", "team_differs_naming_convention"], uci_rider_id: "2", primary_specialty: "unknown", young_rider_eligible: true },
    { date_of_birth: null, date_of_birth_source: "unknown", dob_conflict: false, uci_match_confidence: "low", uci_match_reasons: ["nationality_conflict"], uci_rider_id: null, primary_specialty: "unknown", young_rider_eligible: null },
  ];
  const existing = [{ id: "existing-1", source_url: null, normalized_name: "someone else" }];
  const plan = planRiderImport(
    [
      { display_name: "A", normalized_name: "a", source_url: null },
      { display_name: "B", normalized_name: "b", source_url: null },
    ],
    existing,
  );
  const summary = buildSourceSummary({
    rosterRows,
    plan,
    sourceFailures: [{ source: "uci.org", url: "x", message: "blocked" }],
    uciSearchStats: { searchesAttempted: 5, candidatesFound: 3 },
    circuitBreakerState: { open: false, consecutiveAccessDeniedCount: 0, openedAt: null, triggeringStatus: null, threshold: 3 },
  });
  assert.equal(summary.officialRosterCount, 3);
  assert.equal(summary.uciSearchesAttempted, 5);
  assert.equal(summary.uciCandidatesFound, 3);
  assert.equal(summary.highConfidenceMatches, 1);
  assert.equal(summary.mediumConfidenceMatches, 1);
  assert.equal(summary.lowConfidenceOrAmbiguousMatches, 1);
  assert.equal(summary.uciDobCoverage.known, 1);
  assert.equal(summary.retainedExistingDobCount, 1);
  assert.equal(summary.dobConflicts, 1);
  assert.equal(summary.uciNationalityConflicts, 1);
  assert.equal(summary.uciTeamMismatches, 1);
  assert.equal(summary.missingUciProfiles, 1);
  assert.equal(summary.circuitBreakerActivations, 0);
  assert.equal(summary.specialtyUnknownCount, 2);
  assert.equal(summary.youngRiderEligibleCount, 1);
  assert.equal(summary.reviewRequiredCount, 0);
  assert.equal(summary.sourceFailures.length, 1);
});

test("buildSourceSummary reports a circuit-breaker activation", () => {
  const summary = buildSourceSummary({
    rosterRows: [],
    plan: planRiderImport([], []),
    sourceFailures: [],
    uciSearchStats: { searchesAttempted: 0, candidatesFound: 0 },
    circuitBreakerState: { open: true, consecutiveAccessDeniedCount: 3, openedAt: "2026-07-16T00:00:00.000Z", triggeringStatus: 403, threshold: 3 },
  });
  assert.equal(summary.circuitBreakerActivations, 1);
});
