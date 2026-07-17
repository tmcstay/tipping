import assert from "node:assert/strict";
import test from "node:test";

import { matchRaceEntryToRegistry, scoreRaceEntryCandidate } from "./race-entry-rider-matching.mjs";

function canonicalRider(overrides = {}) {
  return {
    id: "canonical-1",
    uci_rider_id: "149727",
    display_name: "Tadej Pogačar",
    normalized_name: "tadej pogacar",
    nationality: "SLO",
    current_team_name: "UAE Team Emirates XRG",
    date_of_birth: "1998-09-21",
    ...overrides,
  };
}

function entry(overrides = {}) {
  return {
    entryName: "Tadej Pogacar",
    entryTeamName: "UAE Team Emirates",
    entryNationality: "SLO",
    entryBibNumber: 1,
    ...overrides,
  };
}

test("tier 1: explicit UCI rider id on the entry matches directly, high confidence", () => {
  const result = matchRaceEntryToRegistry(entry({ uciRiderId: "149727" }), { canonicalRiders: [canonicalRider()] });
  assert.equal(result.matchedRiderId, "canonical-1");
  assert.equal(result.matchMethod, "uci_rider_id");
  assert.equal(result.confidence, "high");
  assert.equal(result.reviewRequired, false);
});

test("tier 1: an explicit UCI rider id that matches nothing in the registry is a review item, not a silent name-match fallback", () => {
  const result = matchRaceEntryToRegistry(entry({ uciRiderId: "999999" }), { canonicalRiders: [canonicalRider()] });
  assert.equal(result.matchedRiderId, null);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.reviewReason, "unmatched_uci_rider_id");
});

test("tier 3: exact canonical normalized-name match (no UCI id on the entry)", () => {
  const result = matchRaceEntryToRegistry(entry(), { canonicalRiders: [canonicalRider()] });
  assert.equal(result.matchedRiderId, "canonical-1");
  assert.equal(result.matchMethod, "canonical_name");
  assert.equal(result.confidence, "high");
});

test("tier 4: exact alias match, used only when the name itself doesn't already resolve uniquely", () => {
  const result = matchRaceEntryToRegistry(
    entry({ entryName: "Pogacar Tadej" }),
    {
      canonicalRiders: [canonicalRider()],
      aliases: [{ rider_id: "canonical-1", normalized_alias: "pogacar tadej", alias_type: "surname_first", confidence: "medium" }],
    },
  );
  assert.equal(result.matchedRiderId, "canonical-1");
  assert.equal(result.matchMethod, "alias");
});

test("tier 4: an alias shared by two different riders is ambiguous, routed to review (low_confidence_alias_match)", () => {
  const result = matchRaceEntryToRegistry(
    entry({ entryName: "J Smith" }),
    {
      canonicalRiders: [canonicalRider(), canonicalRider({ id: "canonical-2", uci_rider_id: "2", normalized_name: "someone else" })],
      aliases: [
        { rider_id: "canonical-1", normalized_alias: "j smith", alias_type: "abbreviated", confidence: "low" },
        { rider_id: "canonical-2", normalized_alias: "j smith", alias_type: "abbreviated", confidence: "low" },
      ],
    },
  );
  assert.equal(result.matchedRiderId, null);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.reviewReason, "low_confidence_alias_match");
});

test("tier 5: two riders sharing the exact same normalized name (ambiguous at tier 3) are disambiguated by team+nationality scoring", () => {
  const riderA = canonicalRider({ id: "a", uci_rider_id: "a", current_team_name: "UAE Team Emirates XRG" });
  const riderB = canonicalRider({ id: "b", uci_rider_id: "b", nationality: "FRA", current_team_name: "Some Other Team" });
  const result = matchRaceEntryToRegistry(
    entry({ entryNationality: "SLO", entryTeamName: "UAE Team Emirates" }),
    { canonicalRiders: [riderA, riderB] },
  );
  assert.equal(result.matchedRiderId, "a", "only riderA's nationality+team agree with the entry");
  assert.equal(result.matchMethod, "scored");
});

test("scoreRaceEntryCandidate: a DOB conflict forces low confidence, overriding an otherwise perfect name/nationality/team match", () => {
  const score = scoreRaceEntryCandidate(
    { entryName: "Tadej Pogacar", entryNationality: "SLO", entryTeamName: "UAE Team Emirates", entryDateOfBirth: "2000-01-01" },
    canonicalRider(),
  );
  assert.equal(score.confidence, "low");
  assert.equal(score.dobConflict, true);
});

test("a DOB conflict at the scored tier rejects the automatic match and routes to review, never guesses", () => {
  // Two riders sharing the exact same normalized name (so tier 3 is
  // ambiguous and scoring runs); the entry's DOB conflicts with the only
  // otherwise-plausible one (team+nationality agree), which must reject
  // that candidate rather than matching it anyway.
  const riderA = canonicalRider({ id: "a", uci_rider_id: "a", current_team_name: "UAE Team Emirates XRG" });
  const riderB = canonicalRider({ id: "b", uci_rider_id: "b", nationality: "FRA", current_team_name: "Some Other Team" });
  const result = matchRaceEntryToRegistry(
    entry({ entryNationality: "SLO", entryTeamName: "UAE Team Emirates", entryDateOfBirth: "2000-01-01" }),
    { canonicalRiders: [riderA, riderB] },
  );
  assert.equal(result.matchedRiderId, null);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.reviewReason, "dob_conflict");
});

test("multiple plausible scored candidates degrade to ambiguous_candidate review, never picks the first", () => {
  const riderA = canonicalRider({ id: "a", uci_rider_id: "a", current_team_name: null });
  const riderB = canonicalRider({ id: "b", uci_rider_id: "b", current_team_name: null });
  const result = matchRaceEntryToRegistry(
    entry({ entryTeamName: null }),
    { canonicalRiders: [riderA, riderB] },
  );
  assert.equal(result.matchedRiderId, null);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.reviewReason, "ambiguous_candidate");
});

test("tier 6: no match at all in an empty registry is a clean unmatched_startlist_rider review item", () => {
  const result = matchRaceEntryToRegistry(entry(), { canonicalRiders: [] });
  assert.equal(result.matchedRiderId, null);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.reviewReason, "unmatched_startlist_rider");
});

test("sourceEntry carries the race-specific fields (name/team/nationality/bib) but they are never confused with the canonical rider's own record", () => {
  const result = matchRaceEntryToRegistry(entry({ entryBibNumber: 42 }), { canonicalRiders: [canonicalRider()] });
  assert.deepEqual(result.sourceEntry, { name: "Tadej Pogacar", team: "UAE Team Emirates", nationality: "SLO", bib: 42 });
});

test("tier 5: a lone low-confidence candidate whose fuller UCI name contains the entry's compact name is surfaced for review, never discarded (real letour-vs-UCI name-format case)", () => {
  // Real case found live: letour's roster lists "Jonas Vingegaard" but the
  // UCI registry's own display_name is "Jonas Vingegaard Hansen" -- an
  // exact-name match fails (tier 3), and scoreRaceEntryCandidate scores it
  // "low" purely because nameMatch requires exact equality, not because
  // the candidate is actually implausible. Before this fix,
  // pickScoredCandidate discarded this candidate outright, leaving a human
  // reviewer nothing to look at even though the right rider was sitting in
  // the registry the whole time.
  const candidate = canonicalRider({
    id: "vingegaard-1",
    uci_rider_id: "112082",
    display_name: "Jonas Vingegaard Hansen",
    normalized_name: "jonas vingegaard hansen",
    nationality: "DEN",
    current_team_name: "Team Visma | Lease a Bike",
    date_of_birth: null,
  });
  const result = matchRaceEntryToRegistry(
    entry({ entryName: "Jonas Vingegaard", entryTeamName: "Team Visma | Lease A Bike", entryNationality: "DEN" }),
    { canonicalRiders: [candidate] },
  );
  assert.equal(result.matchedRiderId, null, "still not auto-matched -- a human must confirm");
  assert.equal(result.reviewRequired, true);
  assert.equal(result.reviewReason, "ambiguous_candidate");
  assert.deepEqual(result.evidence.candidateIds, ["vingegaard-1"], "the real candidate must be surfaced, not discarded");
  assert.ok(result.evidence.reasons.includes("partial_name_match"));
});

test("tier 5: a DOB conflict still excludes a candidate from partial-name surfacing, even though the names overlap", () => {
  const candidate = canonicalRider({
    id: "vingegaard-1",
    uci_rider_id: "112082",
    display_name: "Jonas Vingegaard Hansen",
    normalized_name: "jonas vingegaard hansen",
    nationality: "DEN",
    date_of_birth: "1996-12-10",
  });
  const result = matchRaceEntryToRegistry(
    entry({ entryName: "Jonas Vingegaard", entryNationality: "DEN", entryDateOfBirth: "2001-01-01" }),
    { canonicalRiders: [candidate] },
  );
  assert.equal(result.matchedRiderId, null);
  assert.equal(result.reviewRequired, true);
  assert.deepEqual(result.evidence.candidateIds ?? [], [], "a DOB-conflicting candidate must never be surfaced as a plausible partial-name match");
});

test("tier 5: too many partial-name candidates (a common surname across many rows) falls back to the generic aggregated-reasons review, not a noisy candidate dump", () => {
  const candidates = Array.from({ length: 8 }, (_, index) => canonicalRider({
    id: `candidate-${index}`,
    uci_rider_id: `id-${index}`,
    display_name: `Some Rider ${index} Smith`,
    normalized_name: `some rider ${index} smith`,
    nationality: "SLO",
    current_team_name: null,
    date_of_birth: null,
  }));
  const result = matchRaceEntryToRegistry(
    entry({ entryName: "Smith", entryTeamName: null }),
    { canonicalRiders: candidates },
  );
  assert.equal(result.matchedRiderId, null);
  assert.equal(result.reviewRequired, true);
  assert.deepEqual(result.evidence.candidateIds ?? [], []);
});
