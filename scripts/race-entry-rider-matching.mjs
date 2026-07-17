import { normalizeRiderName, normalizeTeamName } from "./tdf-data-utils.mjs";

/**
 * The generalized, race-agnostic rider-identity matching service: matches
 * one race-entry row (a startlist/roster entry for ANY race, not just the
 * Tour) against the cross-race `public.uci_riders` master registry plus
 * its aliases. Refactored out of scripts/grandtour-reconciliation.mjs's
 * `classifyRiderMatch`/`classifyTeamMatch`, which stay UNCHANGED and keep
 * doing their existing, narrower job (matching an official stage
 * RESULT's rider rows against a single tour's already-matched
 * grandtour_riders, for the results pipeline) -- this module is a new,
 * separate, more general service for matching a race ENTRY (a startlist
 * row, before any tour-specific rider row necessarily even exists yet)
 * against the canonical registry.
 *
 * Priority order (never falls through past the first tier that produces
 * a confident, unambiguous answer):
 *   1. Explicit UCI rider id already known on the entry (e.g. carried
 *      over from a prior sync/import) -- the strongest possible signal.
 *   2. Another trusted external id, pass-through only -- no such id type
 *      exists in this codebase yet; the tier exists so a future source
 *      (e.g. a different federation's id) has somewhere to plug in
 *      without a redesign.
 *   3. Exact canonical normalized-name match against uci_riders.
 *   4. Exact alias match against uci_rider_aliases.
 *   5. Scored candidate: name/nationality/team evidence, generalizing
 *      scripts/uci-match.mjs's scoreUciCandidate tiers. A DOB conflict
 *      (both entry and candidate carry a DOB and they disagree) always
 *      rejects an automatic match at this tier, regardless of how well
 *      everything else agrees -- routed to manual review instead.
 *   6. Manual review queue -- no confident match; never guessed.
 *
 * Returns a uniform result contract regardless of tier: `{ matchedRiderId,
 * matchMethod, confidence, evidence, sourceEntry: {name, team,
 * nationality, bib}, reviewRequired, reviewReason }`. Race-specific fields
 * (bib number, entered team) are captured in `sourceEntry` for the
 * caller's own record-keeping (e.g. a review-queue payload) but are NEVER
 * written back onto the canonical uci_riders row -- that row only ever
 * carries cross-race identity fields.
 */

function buildSourceEntry(entry) {
  return {
    name: entry.entryName ?? null,
    team: entry.entryTeamName ?? null,
    nationality: entry.entryNationality ?? null,
    bib: entry.entryBibNumber ?? null,
  };
}

function baseResult(entry, overrides) {
  return {
    matchedRiderId: null,
    matchMethod: null,
    confidence: "low",
    evidence: {},
    sourceEntry: buildSourceEntry(entry),
    reviewRequired: false,
    reviewReason: null,
    ...overrides,
  };
}

function normalizeCode(value) {
  return value ? String(value).trim().toUpperCase() : null;
}

/**
 * Bounds how many low-confidence "fuzzy" candidates get surfaced for human
 * review when nothing scores high/medium -- never the whole scored pool
 * (which, when scoring against the entire registry rather than a narrow
 * byName-ambiguous subset, could be hundreds of irrelevant rows that only
 * coincidentally share a nationality code).
 */
const MAX_SURFACED_LOW_CONFIDENCE_CANDIDATES = 5;

/**
 * True when one normalized name is fully contained in the other, or they
 * share the same final word (family name) -- the exact shape of the real,
 * common "letour's compact name vs UCI's fuller name" mismatch (e.g.
 * "jonas vingegaard" vs "jonas vingegaard hansen", "isaac del toro" vs
 * "isaac del toro romero"). Deliberately narrower than a generic fuzzy/edit-
 * distance match so an unrelated same-nationality rider is never surfaced
 * just because scoreRaceEntryCandidate happened to score it.
 */
function hasPartialNameOverlap(entryNameNormalized, candidateNameNormalized) {
  if (!entryNameNormalized || !candidateNameNormalized) return false;
  if (entryNameNormalized === candidateNameNormalized) return false; // already an exact match elsewhere
  if (candidateNameNormalized.includes(entryNameNormalized) || entryNameNormalized.includes(candidateNameNormalized)) return true;
  const entryLastWord = entryNameNormalized.split(" ").at(-1);
  const candidateLastWord = candidateNameNormalized.split(" ").at(-1);
  return Boolean(entryLastWord && candidateLastWord && entryLastWord === candidateLastWord);
}

/**
 * Scores one canonical candidate against a race entry -- generalizes
 * scripts/uci-match.mjs's scoreUciCandidate's tiers (high/medium/low) to
 * operate on uci_riders' own field shape instead of a raw UCI search hit.
 * A DOB conflict (both sides carry a DOB, and they disagree) always
 * forces "low", overriding every other signal -- per this module's own
 * "DOB conflict rejects auto-match" rule.
 */
export function scoreRaceEntryCandidate(entry, candidate) {
  const reasons = [];

  const entryNameNormalized = normalizeRiderName(entry.entryName ?? "");
  const candidateNameNormalized = normalizeRiderName(candidate.display_name ?? "");
  const nameMatch = entryNameNormalized === candidateNameNormalized;
  if (nameMatch) reasons.push("exact_name_match");
  else reasons.push("fuzzy_name_match_only");

  const entryNationality = normalizeCode(entry.entryNationality);
  const candidateNationality = normalizeCode(candidate.nationality);
  const nationalityKnown = Boolean(entryNationality && candidateNationality);
  const nationalityAgrees = nationalityKnown && entryNationality === candidateNationality;
  const nationalityConflict = nationalityKnown && !nationalityAgrees;
  if (nationalityAgrees) reasons.push("nationality_agrees");
  else if (nationalityConflict) reasons.push("nationality_conflict");
  else reasons.push("nationality_unknown");

  const entryTeamNormalized = entry.entryTeamName ? normalizeTeamName(entry.entryTeamName) : null;
  const candidateTeamNormalized = candidate.current_team_name ? normalizeTeamName(candidate.current_team_name) : null;
  const teamKnown = Boolean(entryTeamNormalized && candidateTeamNormalized);
  const teamAgrees = teamKnown && entryTeamNormalized === candidateTeamNormalized;
  if (teamAgrees) reasons.push("team_agrees");
  else if (teamKnown) reasons.push("team_differs");
  else reasons.push("team_unknown");

  const dobKnown = Boolean(entry.entryDateOfBirth && candidate.date_of_birth);
  const dobAgrees = dobKnown && entry.entryDateOfBirth === candidate.date_of_birth;
  const dobConflict = dobKnown && !dobAgrees;
  if (dobConflict) reasons.push("dob_conflict");
  else if (dobAgrees) reasons.push("dob_agrees");

  let confidence;
  if (dobConflict || !nameMatch || nationalityConflict) {
    confidence = "low";
  } else if (dobAgrees) {
    confidence = "high";
  } else if (nationalityAgrees && teamAgrees) {
    confidence = "high";
  } else if (nationalityAgrees) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return { confidence, reasons, nameMatch, nationalityAgrees, nationalityConflict, teamAgrees, dobAgrees, dobConflict };
}

/**
 * Tier 5: scores every candidate, picks the single plausible (high/medium
 * confidence) one -- never the first of several plausible candidates
 * (mirrors scripts/uci-match.mjs's pickBestUciMatch: >1 plausible
 * candidate degrades to "review", not a guess).
 */
function pickScoredCandidate(entry, candidates) {
  if (!candidates || candidates.length === 0) {
    return { candidate: null, confidence: "low", reasons: ["no_candidates"], plausibleCandidates: [] };
  }
  const scored = candidates.map((candidate) => ({ candidate, ...scoreRaceEntryCandidate(entry, candidate) }));
  const plausible = scored.filter((entryScore) => entryScore.confidence === "high" || entryScore.confidence === "medium");

  if (plausible.length > 1) {
    return { candidate: null, confidence: "low", reasons: ["multiple_plausible_candidates"], plausibleCandidates: plausible.map((s) => s.candidate) };
  }
  if (plausible.length === 1) {
    const best = plausible[0];
    return { candidate: best.candidate, confidence: best.confidence, reasons: best.reasons, plausibleCandidates: [best.candidate] };
  }
  // No plausible (high/medium) candidate. Rather than discarding every
  // scored candidate outright, surface a bounded set of "partial name
  // overlap" candidates -- the real, common case of letour's compact name
  // vs UCI's fuller name (e.g. "Jonas Vingegaard" vs "Jonas Vingegaard
  // Hansen") scoring "low" purely because scoreRaceEntryCandidate's
  // nameMatch requires exact equality, not because the candidate is
  // actually implausible. This mirrors scripts/uci-match.mjs's
  // pickBestUciMatch, which never discards a lone/scored low-confidence
  // candidate outright -- a caller (e.g. the review-queue UI) still needs
  // *something* to show a human for these near-miss cases, not an empty
  // candidate list next to a wall of aggregated reason strings.
  const entryNameNormalized = normalizeRiderName(entry.entryName ?? "");
  const partialNameMatches = scored.filter(
    (entryScore) => !entryScore.dobConflict && !entryScore.nationalityConflict
      && hasPartialNameOverlap(entryNameNormalized, normalizeRiderName(entryScore.candidate.display_name ?? "")),
  );
  if (partialNameMatches.length > 0 && partialNameMatches.length <= MAX_SURFACED_LOW_CONFIDENCE_CANDIDATES) {
    const reasons = [...new Set(partialNameMatches.flatMap((entryScore) => entryScore.reasons))];
    if (!reasons.includes("partial_name_match")) reasons.push("partial_name_match");
    return { candidate: null, confidence: "low", reasons, plausibleCandidates: partialNameMatches.map((s) => s.candidate) };
  }
  // No usable partial-name signal either (or too many to be meaningful,
  // e.g. a very common surname scored against the whole registry):
  // aggregate every scored candidate's own reasons (deduplicated) so the
  // caller can distinguish "a DOB conflict rejected an otherwise strong
  // match" from a plain "nothing matched" -- never collapsed to a single
  // generic reason that would hide which specific rule rejected the match.
  const aggregatedReasons = [...new Set(scored.flatMap((entryScore) => entryScore.reasons))];
  return { candidate: null, confidence: "low", reasons: aggregatedReasons.length ? aggregatedReasons : ["no_plausible_candidate"], plausibleCandidates: [] };
}

/**
 * Matches one race entry against the registry. `registry` is
 * `{ canonicalRiders, aliases }`, both already-fetched flat arrays (the
 * caller, e.g. scripts/tdf-2026-registry-match-report.mjs, is responsible
 * for reading them -- this function does no I/O).
 */
export function matchRaceEntryToRegistry(entry, { canonicalRiders = [], aliases = [] } = {}) {
  // Tier 1: explicit UCI rider id already known on the entry.
  if (entry.uciRiderId) {
    const byId = canonicalRiders.filter((rider) => rider.uci_rider_id === entry.uciRiderId);
    if (byId.length === 1) {
      return baseResult(entry, {
        matchedRiderId: byId[0].id,
        matchMethod: "uci_rider_id",
        confidence: "high",
        evidence: { uciRiderId: entry.uciRiderId },
      });
    }
    if (byId.length > 1) {
      return baseResult(entry, {
        reviewRequired: true,
        reviewReason: "duplicate_uci_identity",
        evidence: { uciRiderId: entry.uciRiderId, candidateIds: byId.map((rider) => rider.id) },
      });
    }
    // A supplied uci_rider_id that matches nothing in the registry is
    // itself worth a review row (a stale/incorrect id), not silently
    // falling through to name matching as if it had never been given.
    return baseResult(entry, {
      reviewRequired: true,
      reviewReason: "unmatched_uci_rider_id",
      evidence: { uciRiderId: entry.uciRiderId },
    });
  }

  // Tier 2: another trusted external id. No such id type exists in this
  // codebase yet (see module doc comment) -- this is a pure pass-through
  // placeholder so a future source has somewhere to plug in.
  if (entry.externalId) {
    const byExternalId = canonicalRiders.filter((rider) => rider.external_id === entry.externalId);
    if (byExternalId.length === 1) {
      return baseResult(entry, {
        matchedRiderId: byExternalId[0].id,
        matchMethod: "external_id",
        confidence: "high",
        evidence: { externalId: entry.externalId },
      });
    }
  }

  // Tier 3: exact canonical normalized-name match.
  const normalizedEntryName = normalizeRiderName(entry.entryName ?? "");
  const byName = canonicalRiders.filter((rider) => rider.normalized_name === normalizedEntryName);
  if (byName.length === 1) {
    return baseResult(entry, {
      matchedRiderId: byName[0].id,
      matchMethod: "canonical_name",
      confidence: "high",
      evidence: { normalizedName: normalizedEntryName },
    });
  }

  // Tier 4: exact alias match -- only when name matching didn't already
  // resolve uniquely (byName.length === 0; if byName.length > 1 the name
  // is itself ambiguous and alias matching wouldn't disambiguate a
  // shared name any better, so it falls through to scoring/review below
  // using the same ambiguous candidate set).
  if (byName.length === 0) {
    const aliasHits = aliases.filter((alias) => alias.normalized_alias === normalizedEntryName);
    const distinctRiderIds = [...new Set(aliasHits.map((alias) => alias.rider_id))];
    if (distinctRiderIds.length === 1) {
      return baseResult(entry, {
        matchedRiderId: distinctRiderIds[0],
        matchMethod: "alias",
        confidence: aliasHits[0].confidence ?? "medium",
        evidence: { normalizedAlias: normalizedEntryName, aliasType: aliasHits[0].alias_type },
      });
    }
    if (distinctRiderIds.length > 1) {
      return baseResult(entry, {
        reviewRequired: true,
        reviewReason: "low_confidence_alias_match",
        evidence: { normalizedAlias: normalizedEntryName, candidateIds: distinctRiderIds },
      });
    }
  }

  // Tier 5: scored candidate. When the name itself was ambiguous
  // (byName.length > 1), score across exactly those candidates rather
  // than the whole registry -- scoring the whole registry would be
  // needlessly expensive and could surface an unrelated same-named
  // candidate as "the only plausible one" by accident.
  const scoringPool = byName.length > 1 ? byName : canonicalRiders;
  const scoredPick = pickScoredCandidate(entry, scoringPool);

  if (scoredPick.candidate) {
    return baseResult(entry, {
      matchedRiderId: scoredPick.candidate.id,
      matchMethod: "scored",
      confidence: scoredPick.confidence,
      evidence: { reasons: scoredPick.reasons },
    });
  }

  // Tier 6: manual review. Every distinguishable "why" is preserved. A
  // partial-name-overlap candidate (see pickScoredCandidate) is routed as
  // "ambiguous_candidate" too -- there IS something concrete for a human to
  // look at and possibly confirm, unlike a genuine "nothing matched at
  // all" case, which stays "unmatched_startlist_rider".
  const reviewReason = (scoredPick.reasons.includes("multiple_plausible_candidates") || scoredPick.reasons.includes("partial_name_match"))
    ? "ambiguous_candidate"
    : (scoredPick.reasons.includes("dob_conflict") ? "dob_conflict" : "unmatched_startlist_rider");

  return baseResult(entry, {
    reviewRequired: true,
    reviewReason,
    evidence: { reasons: scoredPick.reasons, candidateIds: scoredPick.plausibleCandidates.map((c) => c.id) },
  });
}
