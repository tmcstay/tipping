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

  const topResultLines: OfficialCheckResultLine[] = (stage?.parsedRiders ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .slice(0, 10)
    .map((rider) => ({
      position: rider.position,
      riderName: rider.rider_name,
      bibNumber: rider.bib_number ?? null,
      teamName: rider.team_name
    }));

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
    resultLineCount: stage?.matchedRiders?.length ?? topResultLines.length,
    jerseyHolderCount: jerseyHolders.length,
    topResultLines,
    jerseyHolders,
    jerseyFetchMetadata
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
