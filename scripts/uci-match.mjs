import { normalizeRiderName, normalizeTeamName } from "./tdf-data-utils.mjs";

/** `"UAE TEAM EMIRATES XRG (UEX)"` -> `"UAE TEAM EMIRATES XRG"`. UCI's team names always suffix the team code in parentheses; the Tour roster's team names never do, so this must be stripped before a fair comparison. */
export function stripUciTeamCodeSuffix(teamName) {
  return String(teamName ?? "").replace(/\s*\([A-Z0-9]{2,4}\)\s*$/, "").trim();
}

function normalizeNationalityCode(code) {
  return code ? String(code).trim().toUpperCase() : null;
}

// A candidate whose current team name mentions another discipline is a
// same-name rider UCI also tracks under road (everyone in this search is
// ROA-scoped by construction — see scripts/uci-client.mjs) but
// whose *current* affiliation is evidently not a road team — e.g. a
// retired-from-road track specialist who still has an old ROA-discipline
// entry. This is a heuristic on the team-name text, not a discipline code
// (the search API doesn't return one per-candidate); a candidate's own
// `disciplineCode`, if a caller ever supplies one directly (e.g. a
// future non-ROA search), is checked too.
const NON_ROAD_DISCIPLINE_KEYWORDS = ["TRACK", "BMX", "MOUNTAIN BIKE", "MTB", "CYCLO-CROSS", "CYCLOCROSS", "INDOOR CYCLING"];

/**
 * Scores one UCI search candidate against the official Tour roster entry
 * it's being considered for. Pure, deterministic — see the module doc
 * comment on confidence tiers. Never used to auto-pick a candidate by
 * itself; see `pickBestUciMatch`.
 */
export function scoreUciCandidate(officialRider, candidate) {
  const reasons = [];

  const officialNormalized = normalizeRiderName(officialRider.officialName ?? "");
  const candidateFullNormalized = normalizeRiderName(`${candidate.givenName ?? ""} ${candidate.familyName ?? ""}`);
  const candidateAltNormalized = normalizeRiderName(`${candidate.familyName ?? ""} ${candidate.givenName ?? ""}`);

  const exactMatch = candidateFullNormalized === officialNormalized;
  const altOrderMatch = !exactMatch && candidateAltNormalized === officialNormalized;
  const nameMatch = exactMatch || altOrderMatch;
  if (exactMatch) reasons.push("exact_name_match");
  else if (altOrderMatch) reasons.push("alternate_name_order_match");
  else reasons.push("fuzzy_name_match_only");

  const officialNationality = normalizeNationalityCode(officialRider.nationality);
  const candidateNationality = normalizeNationalityCode(candidate.countryCode);
  const nationalityKnown = Boolean(officialNationality && candidateNationality);
  const nationalityAgrees = nationalityKnown && officialNationality === candidateNationality;
  const nationalityConflict = nationalityKnown && !nationalityAgrees;
  if (nationalityAgrees) reasons.push("nationality_agrees");
  else if (nationalityConflict) reasons.push("nationality_conflict");
  else reasons.push("nationality_unknown");

  const candidateTeamRaw = candidate.teamName ?? "";
  const nonRoadDiscipline = NON_ROAD_DISCIPLINE_KEYWORDS.some((keyword) => candidateTeamRaw.toUpperCase().includes(keyword))
    || Boolean(candidate.disciplineCode && candidate.disciplineCode !== "ROA");
  if (nonRoadDiscipline) reasons.push("team_suggests_non_road_discipline");

  const officialTeamNormalized = officialRider.teamName ? normalizeTeamName(officialRider.teamName) : null;
  const candidateTeamNormalized = candidateTeamRaw ? normalizeTeamName(stripUciTeamCodeSuffix(candidateTeamRaw)) : null;
  const teamKnown = Boolean(officialTeamNormalized && candidateTeamNormalized);
  const teamAgrees = teamKnown && officialTeamNormalized === candidateTeamNormalized;
  if (teamAgrees) reasons.push("team_agrees");
  else if (teamKnown) reasons.push("team_differs_naming_convention");
  else reasons.push("team_missing");

  // Confidence tiers (deterministic, in priority order):
  //   low     - a discipline red flag, no name match at all, or a
  //             confirmed nationality conflict, always wins regardless of
  //             anything else.
  //   high    - name matches (exact or alternate order) AND nationality
  //             agrees AND current team agrees (or clearly maps to the
  //             Tour team once the UCI team-code suffix is stripped).
  //   medium  - name matches AND nationality agrees, but team is missing
  //             or differs (naming-convention drift, a mid-season
  //             transfer not yet reflected, etc).
  //   low     - anything else (nationality unknown/unconfirmed, even with
  //             a name match - the spec requires nationality agreement
  //             for both high and medium, not just "not conflicting").
  let confidence;
  if (nonRoadDiscipline || !nameMatch || nationalityConflict) {
    confidence = "low";
  } else if (nationalityAgrees && teamAgrees) {
    confidence = "high";
  } else if (nationalityAgrees) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return { confidence, reasons, nameMatch, exactMatch, altOrderMatch, nationalityAgrees, nationalityConflict, teamAgrees };
}

/**
 * Picks the single UCI candidate to trust for a Tour rider, or explicitly
 * declines to (returning `candidate: null`) when the evidence doesn't
 * support one confident pick. Never returns the first of several
 * plausible candidates — see the `plausible.length > 1` branch, which is
 * exactly "multiple plausible candidates" from this task's low-confidence
 * criteria, not a fallback default.
 */
export function pickBestUciMatch(officialRider, candidates) {
  if (!candidates || candidates.length === 0) {
    return { candidate: null, confidence: "low", reasons: ["no_candidates_found"], candidates: [] };
  }

  const scored = candidates.map((candidate) => ({ candidate, ...scoreUciCandidate(officialRider, candidate) }));
  const plausible = scored.filter((entry) => entry.confidence === "high" || entry.confidence === "medium");

  if (plausible.length > 1) {
    return {
      candidate: null,
      confidence: "low",
      reasons: ["multiple_plausible_candidates"],
      candidates: plausible.map((entry) => entry.candidate),
    };
  }
  if (plausible.length === 1) {
    const best = plausible[0];
    return { candidate: best.candidate, confidence: best.confidence, reasons: best.reasons, candidates: [best.candidate] };
  }
  if (scored.length === 1) {
    const only = scored[0];
    return { candidate: only.candidate, confidence: "low", reasons: only.reasons, candidates: [only.candidate] };
  }
  return {
    candidate: null,
    confidence: "low",
    reasons: ["multiple_ambiguous_low_confidence_candidates"],
    candidates: scored.map((entry) => entry.candidate),
  };
}
