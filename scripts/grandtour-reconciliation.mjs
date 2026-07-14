import { parseLetourElapsedTime } from "./grandtour-feed-provider.mjs";
import { normalizeRiderName, normalizeTeamName } from "./tdf-data-utils.mjs";

/**
 * Pure, DB-free reconciliation of an official-letour parsed stage result
 * against existing GrandTour Supabase records (riders/teams/stages) already
 * loaded into memory. Nothing here reads or writes Supabase directly — see
 * grandtour-reconciliation-supabase.mjs for the thin, read-only query layer
 * that supplies existingRiders/existingTeams/existingStage.
 */

/**
 * Derives an official TTT team classification from the same parsed
 * individual-rider rows already used for every other stage (position,
 * rider_name, bib_number, team_name, time). letour.fr does not publish a
 * separate team-classification table for TTT stages (confirmed: no such
 * tab/AJAX source exists on the rankings hub, unlike the four
 * jersey-classification sub-tabs scraped by
 * extractGeneralClassificationAjaxUrls) — but it doesn't need to, because
 * Tour de France TTT stages have used the UCI's "N=1" scoring rule since it
 * was introduced at the 2023 Paris–Nice: a team's official time is the
 * time of the FIRST rider from that team to cross the line, and every
 * other rider is timed individually from then on. Confirmed against real
 * Stage 1 2026 data: teammates have distinct times, not a shared block
 * time, and each team's minimum time is a real rider's own recorded time —
 * never an average, a guess, or an invented value.
 *
 * Groups parsedRiders by team_name, takes each team's minimum
 * parseLetourElapsedTime(time) as that team's official stage time, and
 * ranks teams ascending by that value (position 1 = fastest team). Riders
 * with a null/unparseable time (a "-" placeholder, a DNF/DNS row, or
 * malformed markup) are excluded from the minimum but don't exclude their
 * team, as long as at least one teammate has a real parseable time.
 *
 * Returns `{ teams, unparsedTeamNames }`. `teams` is ascending by
 * `teamTimeSeconds`, each entry: `{ position, teamName, teamTimeSeconds,
 * firstRiderName, firstRiderBibNumber, riderCount, ridersWithTimeCount }`.
 * `unparsedTeamNames` lists any team_name present in parsedRiders whose
 * every rider had an unparseable time — a real gap the caller must
 * surface as a blocker, never silently drop the team.
 */
export function deriveTeamResultFromRiderRows(parsedRiders) {
  const byTeam = new Map();
  for (const rider of parsedRiders ?? []) {
    const teamName = rider?.team_name ?? null;
    if (!teamName) continue;
    const riders = byTeam.get(teamName) ?? [];
    riders.push(rider);
    byTeam.set(teamName, riders);
  }

  const teams = [];
  const unparsedTeamNames = [];

  for (const [teamName, riders] of byTeam) {
    let fastest = null;
    let ridersWithTimeCount = 0;
    for (const rider of riders) {
      const seconds = parseLetourElapsedTime(rider.time);
      if (seconds === null) continue;
      ridersWithTimeCount += 1;
      if (fastest === null || seconds < fastest.seconds) {
        fastest = {
          seconds,
          riderName: rider.rider_name ?? null,
          bibNumber: Number.isInteger(rider.bib_number) ? rider.bib_number : null
        };
      }
    }
    if (fastest === null) {
      unparsedTeamNames.push(teamName);
      continue;
    }
    teams.push({
      teamName,
      teamTimeSeconds: fastest.seconds,
      firstRiderName: fastest.riderName,
      firstRiderBibNumber: fastest.bibNumber,
      riderCount: riders.length,
      ridersWithTimeCount
    });
  }

  const ranked = teams
    .sort((a, b) => a.teamTimeSeconds - b.teamTimeSeconds)
    .map((team, index) => ({ position: index + 1, ...team }));

  return { teams: ranked, unparsedTeamNames };
}

export function classifyRiderMatch(parsedRider, existingRiders) {
  const normalizedName = normalizeRiderName(parsedRider.rider_name ?? "");
  const bibNumber = Number.isInteger(parsedRider.bib_number) ? parsedRider.bib_number : null;

  const byBib = bibNumber === null ? [] : existingRiders.filter((rider) => rider.bibNumber === bibNumber);
  if (byBib.length === 1) {
    const rider = byBib[0];
    return {
      status: "matched",
      matchedBy: "bib_number",
      riderId: rider.id,
      candidateIds: [rider.id],
      nameMismatch: rider.normalizedName !== normalizedName,
      reason: null
    };
  }
  if (byBib.length > 1) {
    return {
      status: "ambiguous",
      matchedBy: "bib_number",
      riderId: null,
      candidateIds: byBib.map((rider) => rider.id),
      nameMismatch: null,
      reason: `Bib number ${bibNumber} matches ${byBib.length} existing riders.`
    };
  }

  const byName = existingRiders.filter((rider) => rider.normalizedName === normalizedName);
  if (byName.length === 1) {
    return {
      status: "matched",
      matchedBy: "name",
      riderId: byName[0].id,
      candidateIds: [byName[0].id],
      nameMismatch: false,
      reason: null
    };
  }
  if (byName.length > 1) {
    return {
      status: "ambiguous",
      matchedBy: "name",
      riderId: null,
      candidateIds: byName.map((rider) => rider.id),
      nameMismatch: null,
      reason: `Rider name "${parsedRider.rider_name}" matches ${byName.length} existing riders and no bib number disambiguates them.`
    };
  }

  return {
    status: "unmatched",
    matchedBy: null,
    riderId: null,
    candidateIds: [],
    nameMismatch: null,
    reason: `No existing rider found for "${parsedRider.rider_name}"${bibNumber !== null ? ` (bib ${bibNumber})` : ""}.`
  };
}

export function classifyTeamMatch(parsedTeamName, existingTeams) {
  const normalizedName = normalizeTeamName(parsedTeamName ?? "");

  const byCode = existingTeams.filter((team) => team.code && normalizeTeamName(team.code) === normalizedName);
  if (byCode.length === 1) {
    return { status: "matched", matchedBy: "code", teamId: byCode[0].id, candidateIds: [byCode[0].id], reason: null };
  }
  if (byCode.length > 1) {
    return {
      status: "ambiguous",
      matchedBy: "code",
      teamId: null,
      candidateIds: byCode.map((team) => team.id),
      reason: `Team code matching "${parsedTeamName}" matches ${byCode.length} existing teams.`
    };
  }

  const byName = existingTeams.filter((team) =>
    normalizeTeamName(team.name) === normalizedName
    || (team.shortName && normalizeTeamName(team.shortName) === normalizedName));
  if (byName.length === 1) {
    return { status: "matched", matchedBy: "name", teamId: byName[0].id, candidateIds: [byName[0].id], reason: null };
  }
  if (byName.length > 1) {
    return {
      status: "ambiguous",
      matchedBy: "name",
      teamId: null,
      candidateIds: byName.map((team) => team.id),
      reason: `Team name "${parsedTeamName}" matches ${byName.length} existing teams.`
    };
  }

  return {
    status: "unmatched",
    matchedBy: null,
    teamId: null,
    candidateIds: [],
    reason: `No existing team found for "${parsedTeamName}".`
  };
}

/**
 * Checks matched-rider report entries (each already carrying a riderId)
 * against the stage's grandtour_stage_startlists rows. Mirrors the DB-level
 * check in grandtour_private.validate_result_line(), which raises "Result
 * rider must be on the stage start list." if no startlist row exists for
 * (stage_id, rider_id) — this lets reconciliation catch that failure mode
 * before an apply attempt ever reaches the trigger. Presence of any row is
 * sufficient (the trigger does not filter by status), so this check does
 * not filter by status either.
 */
export function checkStartlistMembership(matchedRiders, existingStartlist) {
  const startlistRiderIds = new Set((existingStartlist ?? []).map((row) => row.riderId));
  const onStartlist = [];
  const missingFromStartlist = [];
  for (const rider of matchedRiders) {
    if (rider.riderId !== null && startlistRiderIds.has(rider.riderId)) {
      onStartlist.push(rider);
    } else {
      missingFromStartlist.push(rider);
    }
  }
  return { onStartlist, missingFromStartlist };
}

export const REQUIRED_JERSEY_TYPES = ["yellow", "green", "kom", "white"];

// classifyRiderMatch() reports matchedBy as "bib_number" or "name"; the
// jersey-holder report contract (docs/grandtour-results-feed.md) instead
// uses "normalized_name" for the latter, and reserves "manual_alias" for a
// future explicit alias map (not implemented — no real sponsor-name
// collision has been found that normalizeTeamName/normalizeRiderName can't
// already resolve; see scripts/tdf-data-utils.mjs).
function toJerseyHolderMatchedBy(matchedBy) {
  if (matchedBy === "name") return "normalized_name";
  return matchedBy;
}

/**
 * Reconciles the four end-of-stage classification leaders parsed by
 * parseLetourJerseyHolders() (scripts/grandtour-feed-provider.mjs) against
 * existing riders/teams/startlist, mirroring classifyRiderMatch/
 * classifyTeamMatch's precedence (bib number first, then normalized name).
 * Read-only, like the rest of this module.
 */
export function reconcileJerseyHolders(parsedJerseyHolders, { existingRiders = [], existingTeams = [], existingStartlist = [] } = {}) {
  const byType = new Map();
  for (const holder of parsedJerseyHolders ?? []) {
    if (holder?.jerseyType) byType.set(holder.jerseyType, holder);
  }
  const startlistRiderIds = new Set((existingStartlist ?? []).map((row) => row.riderId));

  const jerseyHolders = [];
  const blockers = [];

  for (const jerseyType of REQUIRED_JERSEY_TYPES) {
    const parsed = byType.get(jerseyType);
    const label = `${jerseyType.charAt(0).toUpperCase()}${jerseyType.slice(1)}`;

    if (!parsed) {
      blockers.push(`Missing ${jerseyType} jersey holder.`);
      jerseyHolders.push({
        jerseyType,
        sourceClassification: null,
        parsedRiderName: null,
        parsedTeamName: null,
        bibNumber: null,
        matchedRiderId: null,
        matchedBy: null,
        nameMismatch: false,
        teamMismatch: false,
        onStartlist: false,
        status: "missing"
      });
      continue;
    }

    const riderMatch = classifyRiderMatch(
      { rider_name: parsed.parsedRiderName ?? "", bib_number: Number.isInteger(parsed.bibNumber) ? parsed.bibNumber : null },
      existingRiders
    );

    if (riderMatch.status === "unmatched") {
      blockers.push(`Unmatched ${jerseyType} jersey holder.`);
    } else if (riderMatch.status === "ambiguous") {
      blockers.push(`Ambiguous ${jerseyType} jersey holder.`);
    }

    let teamMismatch = false;
    if (riderMatch.status === "matched" && parsed.parsedTeamName) {
      const teamMatch = classifyTeamMatch(parsed.parsedTeamName, existingTeams);
      const matchedRider = existingRiders.find((rider) => rider.id === riderMatch.riderId);
      teamMismatch = teamMatch.status === "matched" && matchedRider ? teamMatch.teamId !== matchedRider.teamId : false;
    }

    const onStartlist = riderMatch.status === "matched" ? startlistRiderIds.has(riderMatch.riderId) : false;
    if (riderMatch.status === "matched" && !onStartlist) {
      blockers.push(`${label} jersey holder is not on the stage startlist.`);
    }

    jerseyHolders.push({
      jerseyType,
      sourceClassification: parsed.sourceClassification ?? null,
      parsedRiderName: parsed.parsedRiderName ?? null,
      parsedTeamName: parsed.parsedTeamName ?? null,
      bibNumber: Number.isInteger(parsed.bibNumber) ? parsed.bibNumber : null,
      matchedRiderId: riderMatch.riderId,
      matchedBy: toJerseyHolderMatchedBy(riderMatch.matchedBy),
      nameMismatch: riderMatch.status === "matched" ? riderMatch.nameMismatch : false,
      teamMismatch,
      onStartlist,
      status: riderMatch.status === "matched" && !onStartlist ? "not_on_startlist" : riderMatch.status
    });
  }

  return { jerseyHolders, blockers };
}

export function detectDuplicateBibConflicts(parsedRiders) {
  const ridersByBib = new Map();
  for (const rider of parsedRiders ?? []) {
    if (!Number.isInteger(rider.bib_number)) continue;
    const names = ridersByBib.get(rider.bib_number) ?? [];
    names.push(rider.rider_name);
    ridersByBib.set(rider.bib_number, names);
  }
  return [...ridersByBib.entries()]
    .filter(([, riderNames]) => riderNames.length > 1)
    .map(([bibNumber, riderNames]) => ({ bibNumber, riderNames }));
}

/**
 * Matches a derived TTT team result (deriveTeamResultFromRiderRows) against
 * existing GrandTour teams, the same way individual riders/jersey holders
 * are matched elsewhere in this module — reusing classifyTeamMatch's own
 * precedence (team code, then normalized name). Read-only.
 *
 * Returns `{ teams, blockers }`. `teams` preserves derivation order
 * (position 1 = fastest team, per the UCI N=1 rule); each entry carries the
 * matched `teamId`/`matchedBy` (null if unmatched/ambiguous) alongside the
 * original derivation fields, so a future apply step can build
 * grandtour_stage_team_result_lines rows directly from this without a
 * second lookup. `blockers` covers an unmatched/ambiguous derived team, and
 * (via deriveTeamResultFromRiderRows's own unparsedTeamNames) any team with
 * zero riders carrying a real finishing time — nothing here decides
 * overall safeToApply; the caller folds these blockers in like any other.
 */
export function reconcileTeamTimeTrialResult(parsedRiders, { existingTeams = [] } = {}) {
  const { teams, unparsedTeamNames } = deriveTeamResultFromRiderRows(parsedRiders);
  const blockers = [];

  const matchedTeamResults = teams.map((team) => {
    const match = classifyTeamMatch(team.teamName, existingTeams);
    if (match.status === "unmatched") {
      blockers.push(`Derived TTT team result "${team.teamName}" has no matching existing team.`);
    } else if (match.status === "ambiguous") {
      blockers.push(`Derived TTT team result "${team.teamName}" matches ${match.candidateIds.length} existing teams.`);
    }
    return { ...team, teamId: match.teamId, matchedBy: match.matchedBy };
  });

  for (const teamName of unparsedTeamNames) {
    blockers.push(`No rider on team "${teamName}" has a parseable finishing time; a team result could not be derived for it.`);
  }

  return { teams: matchedTeamResults, blockers };
}

/**
 * Reconciles one parsed official-letour stage result against existing
 * GrandTour records. Read-only: never mutates its inputs and never talks to
 * Supabase itself.
 */
export function reconcileStageResult({
  stageNumber,
  stageType = "road",
  parsedStageResult,
  existingStage,
  existingRiders = [],
  existingTeams = [],
  existingStartlist = []
}) {
  // Stage 1 is always TTT for the 2026 route; team_time_trial stage_type is
  // the authoritative signal otherwise.
  const isTtt = stageType === "ttt" || stageNumber === 1;
  const parsedRiders = parsedStageResult?.riders ?? [];

  // The official team-result source *is* now confirmed for TTT stages —
  // see deriveTeamResultFromRiderRows/reconcileTeamTimeTrialResult above:
  // Tour de France TTT stages are scored under the UCI's N=1 rule, so a
  // team's official time is simply the fastest of its own riders' already-
  // parsed individual times, and letour.fr publishes no separate team table
  // to cross-check against anyway. tttTeamResult is computed for every TTT
  // stage regardless of timing rule, so a dry-run report always shows
  // whether the derived team result reconciles cleanly.
  //
  // But that derivation is only *correct* for the UCI's "N=1" rule
  // (grandtour_stages.ttt_timing_rule = 'individual_time', e.g. TDF 2026
  // Stage 1). A stage using the older shared-block-time rule ('team_time',
  // or an unset/unknown rule) needs different derivation logic this
  // codebase doesn't have yet, so it must stay unconditionally unsafe to
  // apply - see the blocker below, which mirrors the same carve-out
  // apply_grandtour_official_stage_result() enforces server-side
  // (20260714020000_grandtour_apply_ttt_individual_time_result.sql).
  const tttTimingRule = existingStage?.tttTimingRule ?? null;
  const isSupportedTtt = isTtt && tttTimingRule === "individual_time";
  const tttTeamResult = isTtt
    ? reconcileTeamTimeTrialResult(parsedRiders, { existingTeams })
    : { teams: [], blockers: [] };

  const duplicateBibConflicts = detectDuplicateBibConflicts(parsedRiders);

  const riderResults = parsedRiders.map((rider) => ({ parsedRider: rider, match: classifyRiderMatch(rider, existingRiders) }));
  const matchedRiders = riderResults.filter((entry) => entry.match.status === "matched");
  const unmatchedRiders = riderResults.filter((entry) => entry.match.status === "unmatched");
  const ambiguousRiders = riderResults.filter((entry) => entry.match.status === "ambiguous");

  const teamResults = parsedRiders.map((rider) => ({ parsedTeamName: rider.team_name, match: classifyTeamMatch(rider.team_name, existingTeams) }));
  const matchedTeams = teamResults.filter((entry) => entry.match.status === "matched");
  const unmatchedTeams = teamResults.filter((entry) => entry.match.status === "unmatched");
  const ambiguousTeams = teamResults.filter((entry) => entry.match.status === "ambiguous");

  const missingStageRecord = existingStage === null || existingStage === undefined;

  const matchedRidersReport = matchedRiders.map((entry) => ({ riderName: entry.parsedRider.rider_name, bibNumber: entry.parsedRider.bib_number ?? null, riderId: entry.match.riderId, matchedBy: entry.match.matchedBy, nameMismatch: entry.match.nameMismatch }));
  const { onStartlist: matchedRidersOnStartlist, missingFromStartlist: matchedRidersMissingFromStartlist } =
    checkStartlistMembership(matchedRidersReport, existingStartlist);
  const noStartlistRowsFound = (existingStartlist ?? []).length === 0;
  const startlistValidationPassed = matchedRidersMissingFromStartlist.length === 0;

  const { jerseyHolders, blockers: jerseyBlockers } = reconcileJerseyHolders(parsedStageResult?.jersey_holders ?? [], {
    existingRiders,
    existingTeams,
    existingStartlist
  });

  const blockers = [];
  if (missingStageRecord) blockers.push(`No grandtour_stages record found for stage ${stageNumber}.`);
  if (parsedRiders.length === 0) blockers.push("No parsed rider rows to reconcile.");
  if (ambiguousRiders.length > 0) blockers.push(`${ambiguousRiders.length} rider match(es) are ambiguous.`);
  if (unmatchedRiders.length > 0) blockers.push(`${unmatchedRiders.length} parsed rider(s) have no matching existing rider.`);
  if (ambiguousTeams.length > 0) blockers.push(`${ambiguousTeams.length} team match(es) are ambiguous.`);
  if (unmatchedTeams.length > 0) blockers.push(`${unmatchedTeams.length} parsed team(s) have no matching existing team.`);
  if (duplicateBibConflicts.length > 0) blockers.push(`${duplicateBibConflicts.length} duplicate bib number(s) found in the parsed stage result.`);
  if (matchedRidersMissingFromStartlist.length > 0) {
    blockers.push(
      noStartlistRowsFound
        ? `No grandtour_stage_startlists rows were found for stage ${stageNumber}; startlist membership cannot be confirmed for ${matchedRidersMissingFromStartlist.length} matched rider(s).`
        : `${matchedRidersMissingFromStartlist.length} matched rider(s) are not on the stage ${stageNumber} startlist.`
    );
  }
  if (isTtt && !isSupportedTtt) {
    blockers.push(`Stage is a TTT with ttt_timing_rule=${tttTimingRule ?? "(unknown)"}; only individual_time TTT stages are supported for apply, so it remains warning-only and is never safe to apply.`);
  }
  if (isSupportedTtt) blockers.push(...tttTeamResult.blockers);
  blockers.push(...jerseyBlockers);

  return {
    stageNumber,
    // The real grandtour_stages UUID, sourced from the same Supabase read
    // (fetchReconciliationContext's existingStage) reconciliation already
    // used to compute missingStageRecord/matchedRidersOnStartlist above —
    // never a second, later lookup. A future apply step needs this exact
    // id to avoid a time-of-check/time-of-use gap between what was
    // reviewed and what gets written (see docs/grandtour-apply-mode-spec.md §14.4).
    stageId: existingStage?.id ?? null,
    // Informational, from the same stage record, when available; null for
    // a missing stage record. stageDate is the UTC calendar date portion of
    // grandtour_stages.starts_at, not the separate TDF stage-calendar CSV
    // used for scheduling (scripts/grandtour-stage-calendar.mjs) — the two
    // should agree but are sourced independently.
    stageDate: existingStage?.stageDate ?? null,
    // The authoritative grandtour_stages.stage_type value (e.g. "road",
    // "flat", "team_time_trial"), distinct from the stageType *parameter*
    // above, which only drives the isTtt heuristic and may be a caller-side
    // guess (e.g. "stage 1 is always ttt") rather than a DB read.
    stageType: existingStage?.stageType ?? null,
    isTtt,
    // Only meaningful when isTtt is true; null for a non-TTT stage. See
    // isSupportedTtt below.
    tttTimingRule,
    // True only for a TTT stage whose ttt_timing_rule is 'individual_time'
    // - the one case this codebase can derive and apply a team result for.
    // A future apply step (scripts/grandtour-apply.mjs) should gate on
    // this, not on isTtt alone, when deciding whether to build team result
    // lines instead of refusing the stage outright.
    isSupportedTtt,
    // Only populated for a TTT stage (see reconcileTeamTimeTrialResult
    // above): the derived, team-matched TTT result and its own blockers,
    // already folded into the overall blockers list above when
    // isSupportedTtt. Empty/unused for a non-TTT stage.
    tttTeamResult,
    missingStageRecord,
    // The raw parsed rider rows for this stage (position, rider_name,
    // bib_number, team_name, time, gap), verbatim from parsedStageResult.
    // A future apply step needs finishing positions to build RPC result
    // lines, and apply mode must work from a persisted --from-report file
    // with no live re-fetch and no re-run of reconciliation (see
    // docs/grandtour-apply-mode-spec.md §14.1/§14.2) — so the report itself
    // must carry this data, not just the matched/unmatched identity lists.
    parsedRiders,
    matchedRiders: matchedRidersReport,
    unmatchedRiders: unmatchedRiders.map((entry) => ({ riderName: entry.parsedRider.rider_name, bibNumber: entry.parsedRider.bib_number ?? null, reason: entry.match.reason })),
    ambiguousRiders: ambiguousRiders.map((entry) => ({ riderName: entry.parsedRider.rider_name, bibNumber: entry.parsedRider.bib_number ?? null, candidateIds: entry.match.candidateIds, reason: entry.match.reason })),
    matchedTeams: matchedTeams.map((entry) => ({ teamName: entry.parsedTeamName, teamId: entry.match.teamId, matchedBy: entry.match.matchedBy })),
    unmatchedTeams: unmatchedTeams.map((entry) => ({ teamName: entry.parsedTeamName, reason: entry.match.reason })),
    ambiguousTeams: ambiguousTeams.map((entry) => ({ teamName: entry.parsedTeamName, candidateIds: entry.match.candidateIds, reason: entry.match.reason })),
    duplicateBibConflicts,
    matchedRidersOnStartlist,
    matchedRidersMissingFromStartlist,
    startlistValidationPassed,
    noStartlistRowsFound,
    // The four end-of-stage classification leaders (yellow/green/kom/white),
    // reconciled the same way matched riders are. Any missing/unmatched/
    // ambiguous/off-startlist jersey holder contributes to blockers above
    // and therefore to safeToApply, exactly like a bad result-line match.
    jerseyHolders,
    safeToApply: blockers.length === 0,
    blockers
  };
}

export function buildReconciliationReport({ provider = "official-letour", stageDate = null, stageRangeRequested = { fromStage: null, toStage: null }, stageReconciliations }) {
  const stages = stageReconciliations ?? [];
  return {
    provider,
    dryRun: true,
    applyEnabled: false,
    reconciliationOnly: true,
    stageDate,
    stageRangeRequested,
    generatedAt: new Date().toISOString(),
    stages,
    overallSafeToApply: stages.length > 0 && stages.every((stage) => stage.safeToApply),
    note: "Reconciliation-only dry run comparing official-letour parsed rows against existing Supabase GrandTour records. No Supabase writes occur; apply mode is not implemented."
  };
}
