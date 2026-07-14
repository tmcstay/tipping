import type { GrandTourOfficialCheckReport } from "@tipping-suite/supabase-client";

/**
 * Pure reshaping of a "Run Official Check" report (POST /api/admin/grandtour/run-official-check)
 * into exactly what the admin stage card's collapsible panel needs to
 * render: top-10 parsed result lines, jersey holders, blockers, and parser
 * diagnostics for one specific stage. This never decides whether Mark
 * Checked/Finalise/Score are enabled - those gates (getGrandTourAdminActionAvailability
 * in grandtourAdminExperience.ts) are driven only by what's actually
 * applied in the database, never by a check result, deliberately.
 */

export type OfficialCheckResultLine = {
  position: number;
  riderName: string;
  bibNumber: number | null;
  teamName: string;
};

export type OfficialCheckTeamResultLine = {
  position: number;
  teamName: string;
};

export type OfficialCheckJerseyHolder = {
  jerseyType: string;
  riderName: string | null;
  bibNumber: number | null;
  teamName: string | null;
  status: string;
};

export type OfficialCheckJerseyFetchStatus = {
  jerseyType: string;
  status: string;
};

export type OfficialCheckSummary = {
  fetchedAt: string | null;
  provider: string;
  stageNumber: number;
  parserStatus: string | null;
  parserDriftDetected: boolean;
  safeToApply: boolean | null;
  overallSafeToApply: boolean | null;
  blockers: string[];
  resultLineCount: number;
  jerseyHolderCount: number;
  topResultLines: OfficialCheckResultLine[];
  jerseyHolders: OfficialCheckJerseyHolder[];
  jerseyFetchMetadata: OfficialCheckJerseyFetchStatus[];
  // True for a TTT stage - topResultLines above is always empty in that
  // case (individual finishing positions aren't the applied result for a
  // TTT), and topTeamLines is the derived team result instead. False/empty
  // for a non-TTT stage, and vice versa - never both populated at once,
  // mirroring reconcileStageResult's own isTtt/parsedRiders vs
  // tttTeamResult split.
  isTtt: boolean;
  topTeamLines: OfficialCheckTeamResultLine[];
};

export function summarizeOfficialCheckReport(
  report: GrandTourOfficialCheckReport,
  stageNumber: number
): OfficialCheckSummary {
  const fetchMeta = (report.stageFetchMetadata ?? []).find((entry) => entry.stageNumber === stageNumber) ?? null;
  const stage = (report.reconciliation?.stages ?? []).find((entry) => entry.stageNumber === stageNumber) ?? null;
  const jerseyFetchMetadata = (report.jerseyFetchMetadata ?? [])
    .filter((entry) => entry.stageNumber === stageNumber)
    .map((entry) => ({ jerseyType: entry.jerseyType ?? entry.classification, status: entry.status }));

  const isTtt = stage?.isTtt === true;

  const topResultLines: OfficialCheckResultLine[] = isTtt
    ? []
    : (stage?.parsedRiders ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .slice(0, 10)
      .map((rider) => ({
        position: rider.position,
        riderName: rider.rider_name,
        bibNumber: rider.bib_number ?? null,
        teamName: rider.team_name
      }));

  const topTeamLines: OfficialCheckTeamResultLine[] = isTtt
    ? (stage?.tttTeamResult?.teams ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .slice(0, 10)
      .map((team) => ({ position: team.position, teamName: team.teamName }))
    : [];

  const jerseyHolders: OfficialCheckJerseyHolder[] = (stage?.jerseyHolders ?? []).map((holder) => ({
    jerseyType: holder.jerseyType,
    riderName: holder.parsedRiderName,
    bibNumber: holder.bibNumber,
    teamName: holder.parsedTeamName,
    status: holder.status
  }));

  return {
    fetchedAt: report.fetchedAt ?? null,
    provider: report.provider,
    stageNumber,
    parserStatus: fetchMeta?.status ?? null,
    parserDriftDetected: report.parserDriftDetected === true,
    safeToApply: stage?.safeToApply ?? null,
    overallSafeToApply: report.reconciliation?.overallSafeToApply ?? null,
    blockers: stage?.blockers ?? [],
    resultLineCount: isTtt ? topTeamLines.length : (stage?.matchedRiders?.length ?? topResultLines.length),
    jerseyHolderCount: jerseyHolders.length,
    topResultLines,
    jerseyHolders,
    jerseyFetchMetadata,
    isTtt,
    topTeamLines
  };
}

export const OFFICIAL_CHECK_SAFE_MESSAGE = "Official check passed. Review result details before applying.";

/**
 * Exact required copy for the safe case; null for the unsafe case, where
 * the panel shows the blockers list itself instead of a single message.
 */
export function getOfficialCheckStatusMessage(safeToApply: boolean | null): string | null {
  return safeToApply === true ? OFFICIAL_CHECK_SAFE_MESSAGE : null;
}

/**
 * Whether the "Apply Official Result" button should be enabled: a check
 * must have been run for this stage, it must be safe, and the stage must
 * not already be final. Applying itself re-fetches and re-validates fresh
 * server-side (apps/mobile/api/admin/grandtour/apply-official-result.mjs)
 * regardless - this only decides whether the UI offers the button at all,
 * the same "mirror, don't replace, the server-side gate" pattern as
 * canMarkChecked/canFinalise/canScore in grandtourAdminExperience.ts.
 */
export function canApplyOfficialResult(summary: OfficialCheckSummary | null, isFinal: boolean): boolean {
  return summary !== null && summary.safeToApply === true && !isFinal;
}

/**
 * The exact confirmation-modal copy shown before Apply Official Result,
 * including the stage number and an ISO timestamp the admin is implicitly
 * attesting to at the moment of confirming - mirrors
 * buildMarkCheckedConfirmationMessage in grandtourAdminExperience.ts.
 */
export function buildApplyConfirmationMessage(stageNumber: number, now: Date = new Date()): string {
  return `I have reviewed the official check results for Stage ${stageNumber} and want to apply this result as a draft, at ${now.toISOString()}.`;
}
