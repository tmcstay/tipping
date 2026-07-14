import { normalizeRiderName } from "./tdf-data-utils.mjs";
import { REQUIRED_JERSEY_TYPES } from "./grandtour-reconciliation.mjs";

/**
 * Pure logic for GrandTour official-letour apply mode Phase 3 (CLI wiring).
 * See docs/grandtour-apply-mode-spec.md §14 for the full contract this file
 * implements. Nothing here reads/writes Supabase or the filesystem, and
 * nothing here calls the apply RPC — that happens in
 * scripts/grandtour-feed-import.mjs, which imports these functions.
 *
 * Apply mode reads a previously-generated `--reconcile` report from disk; it
 * never fetches letour.fr live and never re-runs reconciliation. All of the
 * validation below operates purely on the parsed report object.
 */

export const MAX_REPORT_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours, per spec §14.3 gate 4

// A report is "acceptable" for apply if the parse/reconciliation actually
// succeeded, even if importStatus is "review_required" rather than
// "validated" — for the official-letour provider, buildFeedReview's
// importType is always "backfill" once a specific stage is requested, and
// summary.unmatchedRiders (a legacy metric computed from raw payload rows
// that never carry rider_id) is therefore always > 0, which forces
// importStatus to "review_required" even on a clean parse. Real
// rider-matching correctness is gated by reconciliation.stages[].safeToApply
// instead, checked separately below. "failed" (validation errors or parser
// drift) and "skipped" (no stage resolved) are never acceptable.
export const ACCEPTABLE_IMPORT_STATUSES = ["validated", "review_required"];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Validates a loaded --from-report JSON object against every precondition
 * required before apply_grandtour_official_stage_result() may be called
 * (spec §14.3 gate 4's max-age check, §14.5's full checklist). Returns
 * `{ errors, stage }` — `errors` is empty only when the report is fully
 * apply-eligible for `confirmStage`; `stage` is the single matching
 * reconciliation.stages[] entry, or null if it could not be found.
 */
export function validateReportForApply({ report, confirmProvider, confirmStage, now = new Date(), maxAgeMs = MAX_REPORT_AGE_MS }) {
  const errors = [];

  if (report === null || typeof report !== "object") {
    return { errors: ["Report is not a JSON object."], stage: null };
  }

  if (report.provider !== "official-letour") {
    errors.push(`report.provider must be "official-letour" (got ${JSON.stringify(report.provider)}).`);
  }
  if (confirmProvider !== "official-letour") {
    errors.push(`--confirm-provider must be "official-letour" (got ${JSON.stringify(confirmProvider)}).`);
  }
  if (report.provider !== confirmProvider) {
    errors.push(`--confirm-provider (${JSON.stringify(confirmProvider)}) must match report.provider (${JSON.stringify(report.provider)}).`);
  }

  if (report.dryRun !== true) {
    errors.push(`report.dryRun must be true (got ${JSON.stringify(report.dryRun)}).`);
  }
  if (report.applyEnabled !== false) {
    errors.push(`report.applyEnabled must be false (got ${JSON.stringify(report.applyEnabled)}).`);
  }
  if (report.parserDriftDetected !== false) {
    errors.push(`report.parserDriftDetected must be false (got ${JSON.stringify(report.parserDriftDetected)}).`);
  }
  if (!ACCEPTABLE_IMPORT_STATUSES.includes(report.importStatus)) {
    errors.push(`report.importStatus must be one of ${JSON.stringify(ACCEPTABLE_IMPORT_STATUSES)} (got ${JSON.stringify(report.importStatus)}).`);
  }

  if (!Number.isInteger(confirmStage) || confirmStage <= 0) {
    errors.push(`--confirm-stage must be a positive integer (got ${JSON.stringify(confirmStage)}).`);
  } else {
    if (report.fromStage !== confirmStage || report.toStage !== confirmStage) {
      errors.push(`report's stage range (fromStage=${JSON.stringify(report.fromStage)}, toStage=${JSON.stringify(report.toStage)}) must both equal --confirm-stage (${confirmStage}); apply only ever targets a single stage.`);
    }
    const stageFetchEntry = Array.isArray(report.stageFetchMetadata)
      ? report.stageFetchMetadata.find((entry) => entry.stageNumber === confirmStage)
      : null;
    if (!stageFetchEntry) {
      errors.push(`report.stageFetchMetadata has no entry for stage ${confirmStage}.`);
    } else if (stageFetchEntry.status !== "ok") {
      errors.push(`report.stageFetchMetadata for stage ${confirmStage} has status ${JSON.stringify(stageFetchEntry.status)}, not "ok".`);
    }
  }

  if (report.reconciliation === undefined || report.reconciliation === null) {
    errors.push("report.reconciliation is missing; re-run the dry run with --reconcile before applying.");
    return { errors, stage: null };
  }

  if (report.reconciliation.overallSafeToApply !== true) {
    errors.push(`report.reconciliation.overallSafeToApply must be true (got ${JSON.stringify(report.reconciliation.overallSafeToApply)}).`);
  }

  const stages = Array.isArray(report.reconciliation.stages) ? report.reconciliation.stages : [];
  if (stages.length !== 1) {
    errors.push(`report.reconciliation.stages must contain exactly one entry for a single-stage apply (found ${stages.length}).`);
    return { errors, stage: stages[0] ?? null };
  }

  const stage = stages[0];

  if (Number.isInteger(confirmStage) && stage.stageNumber !== confirmStage) {
    errors.push(`report.reconciliation.stages[0].stageNumber (${JSON.stringify(stage.stageNumber)}) does not match --confirm-stage (${confirmStage}).`);
  }
  if (!isUuid(stage.stageId)) {
    errors.push(`report.reconciliation.stages[0].stageId must be a UUID (got ${JSON.stringify(stage.stageId)}).`);
  }
  if (stage.missingStageRecord !== false) {
    errors.push(`report.reconciliation.stages[0].missingStageRecord must be false (got ${JSON.stringify(stage.missingStageRecord)}).`);
  }
  // A TTT stage is apply-eligible only when reconcileStageResult() has
  // already determined it's the one supported case (ttt_timing_rule =
  // 'individual_time', see grandtour-reconciliation.mjs). Every other TTT
  // stage - and every non-TTT stage - keeps the original, unconditional
  // "isTtt must be false" gate.
  if (stage.isSupportedTtt !== true) {
    if (stage.isTtt !== false) {
      errors.push(`report.reconciliation.stages[0].isTtt must be false unless the stage is a supported (individual_time) TTT stage (got isTtt=${JSON.stringify(stage.isTtt)}, isSupportedTtt=${JSON.stringify(stage.isSupportedTtt)}).`);
    }
    if (["team_time_trial", "ttt"].includes(stage.stageType)) {
      errors.push(`report.reconciliation.stages[0].stageType is ${JSON.stringify(stage.stageType)}; only individual_time TTT stages are supported for apply (got ttt_timing_rule=${JSON.stringify(stage.tttTimingRule)}).`);
    }
  }
  if (stage.startlistValidationPassed !== true) {
    errors.push(`report.reconciliation.stages[0].startlistValidationPassed must be true (got ${JSON.stringify(stage.startlistValidationPassed)}).`);
  }
  if (stage.safeToApply !== true) {
    errors.push(`report.reconciliation.stages[0].safeToApply must be true (got ${JSON.stringify(stage.safeToApply)}); blockers=${JSON.stringify(stage.blockers ?? [])}`);
  }

  // Defense in depth on top of safeToApply/blockers above: explicitly
  // confirm all four jersey holders are present and matched, so a report
  // shape that somehow passed safeToApply without a jerseyHolders array
  // (e.g. one generated before this feature existed) is caught here rather
  // than surfacing as a confusing RPC-level error later.
  const jerseyHolders = Array.isArray(stage.jerseyHolders) ? stage.jerseyHolders : [];
  for (const jerseyType of REQUIRED_JERSEY_TYPES) {
    const holder = jerseyHolders.find((entry) => entry.jerseyType === jerseyType);
    if (!holder || holder.status !== "matched" || !holder.matchedRiderId) {
      errors.push(`report.reconciliation.stages[0].jerseyHolders is missing a matched "${jerseyType}" entry (status=${JSON.stringify(holder?.status ?? null)}).`);
    }
  }

  const fetchedAtValue = report.fetchedAt ?? null;
  const fetchedAtMs = fetchedAtValue ? Date.parse(fetchedAtValue) : NaN;
  if (Number.isNaN(fetchedAtMs)) {
    errors.push(`report.fetchedAt must be a parseable timestamp (got ${JSON.stringify(fetchedAtValue)}).`);
  } else {
    const ageMs = now.getTime() - fetchedAtMs;
    if (ageMs > maxAgeMs) {
      errors.push(`report.fetchedAt (${fetchedAtValue}) is ${Math.round(ageMs / 60000)} minute(s) old, older than the ${Math.round(maxAgeMs / 60000)}-minute max age; re-run --reconcile for a fresh report before applying.`);
    } else if (ageMs < 0) {
      errors.push(`report.fetchedAt (${fetchedAtValue}) is in the future relative to now; refusing to trust it.`);
    }
  }

  return { errors, stage };
}

/**
 * Selects the exact set of parsed rider rows to apply, per spec §14.1:
 * v1 CLI-driven apply is **top 10 only**. A real official-letour road/ITT
 * stage always has far more than 10 official finishers, so this is not a
 * meaningful restriction in practice — it exists to remove the ambiguity an
 * earlier draft of this policy left open (a "top 5" fallback that never
 * matched real-world data and was inconsistent with this function's own
 * "never top 5" rationale). Rows with fewer than 10 valid, unique positions
 * in range 1-10 are refused, not silently shrunk to a 5-line apply.
 *
 * Note: the RPC itself (apply_grandtour_official_stage_result) still
 * accepts either exactly 5 or exactly 10 lines at the database level — that
 * constraint exists for schema/finalization generality (it mirrors
 * grandtour_private.validate_final_result(), which also accepts 5 or 10),
 * not because this CLI path is expected to ever send 5. This function is
 * the actual v1 policy gate; the RPC's looser constraint is a defense-in-depth
 * floor, not the policy itself.
 */
export function selectTopNRows(parsedRiders) {
  const positionedRows = [...(parsedRiders ?? [])].filter((row) => Number.isInteger(row.position));

  const positionCounts = new Map();
  for (const row of positionedRows) {
    positionCounts.set(row.position, (positionCounts.get(row.position) ?? 0) + 1);
  }
  const duplicatePositions = [...positionCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([position]) => position)
    .sort((a, b) => a - b);
  if (duplicatePositions.length > 0) {
    return {
      rows: [],
      error: `Parsed rider rows contain duplicate position value(s) (${duplicatePositions.join(", ")}); refusing to apply until the source data is unambiguous.`
    };
  }

  const sortedRows = [...positionedRows].sort((a, b) => a.position - b.position);
  const selected = sortedRows.filter((row) => row.position >= 1 && row.position <= 10);

  if (selected.length !== 10) {
    return {
      rows: [],
      error: `Stage has ${selected.length} official finisher row(s) with a valid position in 1-10 (of ${sortedRows.length} total parsed rows); v1 apply mode requires exactly 10 and cannot apply this stage otherwise.`
    };
  }

  return { rows: selected, error: null };
}

/**
 * Resolves each selected parsed row to a riderId using
 * reconciliation.stages[].matchedRiders (bib number first, then normalized
 * name — the same precedence classifyRiderMatch itself uses in
 * scripts/grandtour-reconciliation.mjs), and builds the exact
 * `{ rider_id, actual_position }` shape the RPC's p_result_lines expects.
 * actual_position is always the row's original parsed position, never a
 * re-numbered index (spec §14.1, point 3).
 */
export function mapRowsToResultLines(rows, matchedRiders) {
  const byBib = new Map();
  const byName = new Map();
  for (const rider of matchedRiders ?? []) {
    if (Number.isInteger(rider.bibNumber)) byBib.set(rider.bibNumber, rider.riderId);
    if (rider.riderName) byName.set(normalizeRiderName(rider.riderName), rider.riderId);
  }

  const resultLines = [];
  for (const row of rows) {
    const riderId = (Number.isInteger(row.bib_number) ? byBib.get(row.bib_number) : undefined)
      ?? byName.get(normalizeRiderName(row.rider_name ?? ""));
    if (!riderId) {
      return {
        resultLines: null,
        error: `Result row at position ${row.position} (bib ${row.bib_number ?? "?"}, "${row.rider_name}") could not be matched to a riderId in reconciliation.matchedRiders. This should be impossible when safeToApply is true; refusing to apply.`
      };
    }
    resultLines.push({ rider_id: riderId, actual_position: row.position });
  }
  return { resultLines, error: null };
}

/**
 * TTT equivalent of selectTopNRows + mapRowsToResultLines combined into
 * one step: unlike a parsed rider row, each entry in
 * stage.tttTeamResult.teams (reconcileTeamTimeTrialResult in
 * grandtour-reconciliation.mjs) already carries its own resolved teamId
 * and derived position, so there's no separate matched-lookup pass needed
 * here. Same v1 policy as the rider path (spec §14.1): exactly 10 rows
 * required, never a "top 5" fallback - a real Grand Tour TTT always has
 * far more than 10 starting teams.
 */
export function selectTopNTeamResultLines(teams) {
  const positionedTeams = [...(teams ?? [])].filter((team) => Number.isInteger(team.position));

  const positionCounts = new Map();
  for (const team of positionedTeams) {
    positionCounts.set(team.position, (positionCounts.get(team.position) ?? 0) + 1);
  }
  const duplicatePositions = [...positionCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([position]) => position)
    .sort((a, b) => a - b);
  if (duplicatePositions.length > 0) {
    return {
      resultLines: null,
      error: `Derived TTT team result contains duplicate position value(s) (${duplicatePositions.join(", ")}); refusing to apply until the derived data is unambiguous.`
    };
  }

  const sortedTeams = [...positionedTeams].sort((a, b) => a.position - b.position);
  const selected = sortedTeams.filter((team) => team.position >= 1 && team.position <= 10);

  if (selected.length !== 10) {
    return {
      resultLines: null,
      error: `Stage has ${selected.length} derived team result row(s) with a valid position in 1-10 (of ${sortedTeams.length} total derived teams); v1 apply mode requires exactly 10 and cannot apply this TTT stage otherwise.`
    };
  }

  for (const team of selected) {
    if (!team.teamId) {
      return {
        resultLines: null,
        error: `Derived TTT team result at position ${team.position} ("${team.teamName}") has no matched teamId. This should be impossible when safeToApply is true; refusing to apply.`
      };
    }
  }

  return {
    resultLines: selected.map((team) => ({ team_id: team.teamId, actual_position: team.position })),
    error: null
  };
}

/**
 * Selects the four reconciled jersey-holder rows (yellow, green, kom, white)
 * to apply, per stage.jerseyHolders. Requires all four to already be
 * status "matched" — this should be unreachable when safeToApply is true
 * (validateReportForApply's defense-in-depth check above already confirms
 * this before apply reaches this point), but is checked again here so this
 * function is safe to call independently, e.g. from tests.
 */
export function selectJerseyHolderParams(stage) {
  const jerseyHolders = Array.isArray(stage?.jerseyHolders) ? stage.jerseyHolders : [];
  const byType = new Map(jerseyHolders.map((holder) => [holder.jerseyType, holder]));

  for (const jerseyType of REQUIRED_JERSEY_TYPES) {
    const holder = byType.get(jerseyType);
    if (!holder || holder.status !== "matched" || !holder.matchedRiderId) {
      return {
        jerseyHolderParams: null,
        error: `Stage jersey holder for "${jerseyType}" is missing or unmatched (status=${JSON.stringify(holder?.status ?? null)}); refusing to apply until all four jersey holders (yellow, green, kom, white) are matched. This should be impossible when safeToApply is true.`
      };
    }
  }

  return {
    jerseyHolderParams: REQUIRED_JERSEY_TYPES.map((jerseyType) => ({
      jersey_type: jerseyType,
      rider_id: byType.get(jerseyType).matchedRiderId
    })),
    error: null
  };
}

/**
 * Builds the exact parameter object for apply_grandtour_official_stage_result(),
 * per spec §14.2's field mapping table. p_finalize is always hardcoded false.
 * p_jersey_holders carries the four reconciled classification leaders
 * (selectJerseyHolderParams above) so the RPC can upsert
 * grandtour_stage_jersey_holders in the same call as the stage result.
 *
 * Exactly one of resultLines/teamResultLines should be non-empty: rider
 * lines for a non-TTT (or unsupported-timing-rule TTT) stage,
 * team lines (selectTopNTeamResultLines above) for a supported
 * (ttt_timing_rule='individual_time') TTT stage — the RPC itself refuses
 * a payload that gets this backwards (see
 * 20260714020000_grandtour_apply_ttt_individual_time_result.sql).
 */
export function buildApplyRpcParams({ report, stage, resultLines = [], teamResultLines = [], jerseyHolderParams, reason = null, requestId = null }) {
  const stageFetchEntry = Array.isArray(report.stageFetchMetadata)
    ? report.stageFetchMetadata.find((entry) => entry.stageNumber === stage.stageNumber)
    : null;

  return {
    p_stage_id: stage.stageId,
    p_result_lines: resultLines,
    p_reconciliation: stage,
    p_dry_run_status: {
      parserStatus: stageFetchEntry?.status ?? null,
      parserDriftDetected: report.parserDriftDetected
    },
    p_source: {
      provider_name: report.provider,
      source_url: stageFetchEntry?.url ?? report.sourceUrl ?? null,
      fetched_at: report.fetchedAt,
      confidence: "official"
    },
    p_finalize: false,
    p_reason: reason ?? `applied via grandtour-feed-import.mjs --apply --confirm-stage=${stage.stageNumber}`,
    p_request_id: requestId ?? `apply-${stage.stageNumber}-${Date.now()}`,
    p_jersey_holders: jerseyHolderParams ?? [],
    p_team_result_lines: teamResultLines
  };
}

/**
 * Classifies an RPC response into a CLI-facing outcome, per spec §14.6.
 * Pure and side-effect-free so it's independently testable without a real
 * Supabase client.
 */
export function interpretRpcResponse({ data, error }) {
  if (error) {
    return { status: "error", exitCode: 1, message: error.message };
  }
  if (data?.status === "no_change") {
    return {
      status: "no_change",
      exitCode: 0,
      message: `No changes: stage ${data.stage_id} already has this exact result applied (stage_result_id=${data.stage_result_id}, line_count=${data.line_count}, jersey_holder_count=${data.jersey_holder_count ?? 0}).`
    };
  }
  if (data?.status === "applied") {
    return {
      status: "applied",
      exitCode: 0,
      message: `Applied: stage_result_id=${data.stage_result_id} import_run_id=${data.import_run_id} line_count=${data.line_count} jersey_holder_count=${data.jersey_holder_count ?? 0}.`
    };
  }
  return { status: "error", exitCode: 1, message: `Unrecognized RPC response: ${JSON.stringify(data)}` };
}

// Known production Supabase project references. Source of truth:
// docs/GRANDTOUR_PRODUCTION_DEPLOYMENT_CHECKLIST.md, which documents the
// linked production project as `tipping-suite` / project ref
// `nsdpilmmrfobiapbwona` (Supabase project URLs are
// `https://<project-ref>.supabase.co`). Update this list if that
// deployment checklist's documented project ref ever changes.
export const KNOWN_PRODUCTION_PROJECT_REFS = ["nsdpilmmrfobiapbwona"];

export function isProductionSupabaseUrl(url, productionRefs = KNOWN_PRODUCTION_PROJECT_REFS) {
  if (!url) return false;
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return productionRefs.some((ref) => hostname === `${ref}.supabase.co`);
}

/**
 * Decodes (without verifying signature) the `role` claim of a Supabase JWT
 * API key, so apply mode can refuse to run with an anon/publishable key even
 * if it was mistakenly placed in SUPABASE_SERVICE_ROLE_KEY. Not a security
 * boundary by itself (the key's actual grants are what matter — see
 * docs/grandtour-apply-mode-spec.md §13.2) — a defense-in-depth sanity check
 * that fails closed (returns null) on any decode error.
 */
export function decodeJwtRole(token) {
  try {
    const segments = String(token).split(".");
    if (segments.length < 2) return null;
    const payload = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(payload, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return typeof parsed?.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}
