/**
 * Pure logic for the admin UI's "Update Results" / correction flow. Mirrors
 * (at lighter fidelity - this is a UX preview, not the security boundary)
 * the same report shape and gates scripts/grandtour-apply.mjs's
 * validateReportForApply and scripts/grandtour-admin-stage.mjs's
 * computeResultDiff/classifyUpdateStatus already enforce for the CLI path.
 * public.correct_grandtour_stage_result_from_reviewed_report is the real,
 * authoritative gate regardless of what this file computes - exactly the
 * same "UI checks are UX only, the RPC is the real gate" model already
 * used throughout the admin panel.
 */

import type { Json } from "@tipping-suite/shared-types";

const MAX_REPORT_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours, matching the CLI's MAX_REPORT_AGE_MS

export type ReportResultLine = { rider_id: string; actual_position: number };
export type ReportJerseyHolder = { jersey_type: "yellow" | "green" | "kom" | "white"; rider_id: string };

export type ParsedCorrectionReport = {
  stageId: string;
  stageNumber: number;
  resultLines: ReportResultLine[];
  jerseyHolders: ReportJerseyHolder[];
  reconciliation: Json;
};

function readReconciliationStage(report: unknown, expectedStageNumber: number): { stage: Record<string, unknown> | null; errors: string[] } {
  const errors: string[] = [];
  if (typeof report !== "object" || report === null) {
    return { stage: null, errors: ["The pasted report is not a valid JSON object."] };
  }
  const r = report as Record<string, unknown>;

  if (r.provider !== "official-letour") errors.push(`report.provider must be "official-letour" (got ${JSON.stringify(r.provider)}).`);
  if (r.dryRun !== true) errors.push("report.dryRun must be true.");
  if (r.applyEnabled !== false) errors.push("report.applyEnabled must be false.");
  if (r.parserDriftDetected !== false) errors.push("report.parserDriftDetected must be false.");

  const fetchedAt = typeof r.fetchedAt === "string" ? Date.parse(r.fetchedAt) : NaN;
  if (Number.isNaN(fetchedAt)) {
    errors.push("report.fetchedAt is missing or not a parseable timestamp.");
  } else {
    const ageMs = Date.now() - fetchedAt;
    if (ageMs > MAX_REPORT_AGE_MS) {
      errors.push(`report.fetchedAt is ${Math.round(ageMs / 60000)} minute(s) old, older than the ${Math.round(MAX_REPORT_AGE_MS / 60000)}-minute max age - run a fresh --reconcile dry-run.`);
    } else if (ageMs < 0) {
      errors.push("report.fetchedAt is in the future; refusing to trust it.");
    }
  }

  const reconciliation = r.reconciliation as Record<string, unknown> | undefined;
  const stages = Array.isArray(reconciliation?.stages) ? (reconciliation!.stages as Record<string, unknown>[]) : [];
  const stage = stages.find((candidate) => candidate.stageNumber === expectedStageNumber) ?? null;
  if (!stage) {
    errors.push(`report.reconciliation.stages has no entry for stage ${expectedStageNumber}.`);
    return { stage: null, errors };
  }

  if (stage.isTtt !== false) errors.push("stage.isTtt must be false; TTT stages are not supported by this flow.");
  if (stage.missingStageRecord !== false) errors.push("stage.missingStageRecord must be false.");
  if (stage.startlistValidationPassed !== true) errors.push("stage.startlistValidationPassed must be true.");
  if (stage.safeToApply !== true) errors.push("stage.safeToApply must be true.");
  for (const field of ["unmatchedRiders", "ambiguousRiders", "unmatchedTeams", "ambiguousTeams", "duplicateBibConflicts"]) {
    const value = stage[field];
    if (Array.isArray(value) && value.length > 0) errors.push(`stage.${field} must be empty (found ${value.length}).`);
  }

  return { stage, errors };
}

/**
 * Parses a pasted/uploaded dry-run report JSON string and extracts the
 * exactly-10-line result + 4 jersey holders for the given stage, in the
 * shape correct_grandtour_stage_result_from_reviewed_report expects.
 * Returns errors instead of throwing - callers show them directly in the UI.
 */
export function parseCorrectionReport(rawJson: string, stageId: string, expectedStageNumber: number): { report: ParsedCorrectionReport | null; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    return { report: null, errors: [`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const { stage, errors } = readReconciliationStage(parsed, expectedStageNumber);
  if (!stage || errors.length > 0) return { report: null, errors };

  const parsedRiders = Array.isArray(stage.parsedRiders) ? (stage.parsedRiders as Record<string, unknown>[]) : [];
  const matchedRiders = Array.isArray(stage.matchedRiders) ? (stage.matchedRiders as Record<string, unknown>[]) : [];
  const jerseyHoldersIn = Array.isArray(stage.jerseyHolders) ? (stage.jerseyHolders as Record<string, unknown>[]) : [];

  const byBib = new Map<number, string>();
  const byName = new Map<string, string>();
  for (const rider of matchedRiders) {
    if (typeof rider.bibNumber === "number") byBib.set(rider.bibNumber, String(rider.riderId));
    if (typeof rider.riderName === "string") byName.set(rider.riderName.trim().toLowerCase(), String(rider.riderId));
  }

  const topTen = parsedRiders
    .filter((row) => typeof row.position === "number" && row.position >= 1 && row.position <= 10)
    .sort((a, b) => (a.position as number) - (b.position as number));

  if (topTen.length !== 10) {
    return { report: null, errors: [`Expected exactly 10 official finisher rows with positions 1-10, found ${topTen.length}.`] };
  }

  const resultLines: ReportResultLine[] = [];
  for (const row of topTen) {
    const bib = typeof row.bib_number === "number" ? row.bib_number : null;
    const name = typeof row.rider_name === "string" ? row.rider_name.trim().toLowerCase() : "";
    const riderId = (bib !== null ? byBib.get(bib) : undefined) ?? byName.get(name);
    if (!riderId) {
      return { report: null, errors: [`Result row at position ${row.position} (bib ${bib ?? "?"}) could not be matched to a riderId in matchedRiders.`] };
    }
    resultLines.push({ rider_id: riderId, actual_position: row.position as number });
  }

  const jerseyTypes = ["yellow", "green", "kom", "white"] as const;
  const jerseyHolders: ReportJerseyHolder[] = [];
  for (const jerseyType of jerseyTypes) {
    const holder = jerseyHoldersIn.find((entry) => entry.jerseyType === jerseyType);
    if (!holder || holder.status !== "matched" || !holder.matchedRiderId) {
      return { report: null, errors: [`Jersey holder for "${jerseyType}" is missing or unmatched.`] };
    }
    jerseyHolders.push({ jersey_type: jerseyType, rider_id: String(holder.matchedRiderId) });
  }

  return {
    report: { stageId, stageNumber: expectedStageNumber, resultLines, jerseyHolders, reconciliation: stage as unknown as Json },
    errors: []
  };
}

export type CorrectionDiffLine = { position: number; currentRiderId: string | null; incomingRiderId: string | null };
export type CorrectionDiffJersey = { jerseyType: "yellow" | "green" | "kom" | "white"; currentRiderId: string | null; incomingRiderId: string | null };

export type CorrectionDiff = {
  resultLinesChanged: boolean;
  jerseyHoldersChanged: boolean;
  changedLines: CorrectionDiffLine[];
  changedJerseys: CorrectionDiffJersey[];
};

/**
 * Diffs the currently-stored result (by rider id, keyed by position/jersey
 * type - callers build these maps from GrandTourStageReviewDetails, which
 * only carries rider *names*, not ids, so the caller must resolve ids
 * separately) against a parsed incoming report. Pure - no I/O.
 */
export function computeCorrectionDiff(
  currentRiderIdByPosition: Map<number, string>,
  currentRiderIdByJerseyType: Map<string, string>,
  incoming: ParsedCorrectionReport
): CorrectionDiff {
  const incomingByPosition = new Map(incoming.resultLines.map((line) => [line.actual_position, line.rider_id]));
  const allPositions = [...new Set([...currentRiderIdByPosition.keys(), ...incomingByPosition.keys()])].sort((a, b) => a - b);
  const changedLines: CorrectionDiffLine[] = [];
  for (const position of allPositions) {
    const currentRiderId = currentRiderIdByPosition.get(position) ?? null;
    const incomingRiderId = incomingByPosition.get(position) ?? null;
    if (currentRiderId !== incomingRiderId) changedLines.push({ position, currentRiderId, incomingRiderId });
  }

  const incomingByJerseyType = new Map(incoming.jerseyHolders.map((holder) => [holder.jersey_type, holder.rider_id]));
  const changedJerseys: CorrectionDiffJersey[] = [];
  for (const jerseyType of ["yellow", "green", "kom", "white"] as const) {
    const currentRiderId = currentRiderIdByJerseyType.get(jerseyType) ?? null;
    const incomingRiderId = incomingByJerseyType.get(jerseyType) ?? null;
    if (currentRiderId !== incomingRiderId) changedJerseys.push({ jerseyType, currentRiderId, incomingRiderId });
  }

  return {
    resultLinesChanged: changedLines.length > 0,
    jerseyHoldersChanged: changedJerseys.length > 0,
    changedLines,
    changedJerseys
  };
}

export type CorrectionSourceState = { isFinal: boolean; scoreCount: number; reviewStatus: string | null };

/**
 * Warning banners shown once a difference is detected, before the admin
 * can apply the correction - requirement Part C #6.
 */
export function getCorrectionWarnings(state: CorrectionSourceState): string[] {
  const warnings: string[] = [];
  if (state.isFinal) warnings.push("This stage has already been finalised.");
  if (state.scoreCount > 0) warnings.push("This stage has existing scores.");
  if (state.isFinal || state.scoreCount > 0) {
    warnings.push("Applying a correction will mark the result as correction_required and unfinalise it if needed; scores must be recalculated afterward.");
  }
  return warnings;
}

/**
 * "Apply Correction" is only enabled when the report is genuinely
 * safeToApply, there's an actual difference to correct, and a reason has
 * been entered - requirement Part C #4/#5/UI requirements.
 */
export function canApplyCorrection(input: { safeToApply: boolean; diff: CorrectionDiff | null; reason: string }): boolean {
  if (!input.safeToApply) return false;
  if (!input.diff) return false;
  if (!input.diff.resultLinesChanged && !input.diff.jerseyHoldersChanged) return false;
  return input.reason.trim().length > 0;
}

export function buildCorrectionConfirmationMessage(stageNumber: number, now: Date = new Date()): string {
  return `I understand this will update an existing result for Stage ${stageNumber} and may require rescoring, at ${now.toISOString()}.`;
}
