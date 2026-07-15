import type { Json } from "@tipping-suite/shared-types";

import { getCurrentSession } from "./auth";
import { getSupabaseClient } from "./client";

/**
 * Admin-only data layer for the GrandTour stage review workflow (draft ->
 * admin_checked -> finalised -> scored). Every write here calls one of the
 * three service_role-independent, auth.uid()-checked RPCs
 * (mark_grandtour_stage_result_checked, finalize_grandtour_stage_result,
 * recalculate_grandtour_stage_scores) - this module never writes to
 * grandtour_stage_results/*_lines/*_jersey_holders/*_scores directly, and
 * the client here always uses the app's normal publishable/anon key (see
 * client.ts), never a service-role key.
 *
 * listGrandTourStageAdminSummaries deliberately issues one query per table
 * (grandtour_stages, grandtour_stage_results, grandtour_stage_result_lines,
 * grandtour_stage_jersey_holders, grandtour_stage_scores) and aggregates
 * client-side, rather than a single joined query - the same "no
 * join-multiplication" approach used by scripts/grandtour-admin-stage.mjs's
 * fetchStageState, scaled to a whole race's worth of stages in one round
 * trip per table instead of one round trip per stage.
 */

export type GrandTourStageAdminSummary = {
  stageId: string;
  stageNumber: number;
  stageType: string;
  stageDate: string | null;
  stageResultId: string | null;
  isFinal: boolean;
  reviewStatus: string | null;
  resultLineCount: number;
  jerseyHolderCount: number;
  scoreCount: number;
  totalScoreAwarded: number;
  top5ScoreAwarded: number;
  jerseyScoreAwarded: number;
  bonusScoreAwarded: number;
  lastAppliedAt: string | null;
};

export type GrandTourAdminResultLine = {
  position: number;
  riderId: string;
  bibNumber: number | null;
  riderName: string;
  teamName: string | null;
};

export type GrandTourAdminTeamResultLine = {
  position: number;
  teamId: string;
  teamName: string;
};

export type GrandTourAdminJerseyHolder = {
  jerseyType: "yellow" | "green" | "kom" | "white";
  riderId: string;
  bibNumber: number | null;
  riderName: string;
  teamName: string | null;
};

export type GrandTourStageReviewDetails = {
  lines: GrandTourAdminResultLine[];
  // Only populated for a TTT stage (see getGrandTourStageAdminReviewDetails'
  // stageType param below) - a non-TTT stage always gets an empty array
  // here, and `lines` above is empty for a TTT stage in turn. Never both
  // populated at once, mirroring grandtour_stage_result_lines/
  // grandtour_stage_team_result_lines themselves never both having rows
  // for the same stage result.
  teamLines: GrandTourAdminTeamResultLine[];
  jerseyHolders: GrandTourAdminJerseyHolder[];
};

/**
 * Whether the given user holds an active 'admin' role on the 'cycling' app
 * (public.apps.code / public.user_app_memberships.role). Both reads are
 * permitted by existing RLS for the authenticated user reading their own
 * membership row - no elevated key is needed. This is a UX gate for
 * showing/hiding the admin panel only; the real security boundary is RLS +
 * the RPCs' own service_role/auth.uid() checks, unchanged by this file.
 */
export async function isGrandTourAdmin(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const client = getSupabaseClient();

  const { data: app, error: appError } = await client
    .from("apps")
    .select("id")
    .eq("code", "cycling")
    .maybeSingle();
  if (appError) throw appError;
  if (!app) return false;

  const { data: membership, error: membershipError } = await client
    .from("user_app_memberships")
    .select("role, status")
    .eq("user_id", userId)
    .eq("app_id", app.id)
    .maybeSingle();
  if (membershipError) throw membershipError;

  return Boolean(membership && membership.role === "admin" && membership.status === "active");
}

// Matches the same TTT stage_type set used throughout the RPCs/scripts
// layer (e.g. apply_grandtour_official_stage_result). Local to this file
// rather than imported from apps/mobile's grandtourAdminExperience.ts,
// since packages/supabase-client must not depend on the app that consumes
// it.
function isTttStageTypeValue(stageType: string | null | undefined): boolean {
  return stageType === "ttt" || stageType === "team_time_trial";
}

export async function listGrandTourStageAdminSummaries(raceId: string): Promise<GrandTourStageAdminSummary[]> {
  const client = getSupabaseClient();

  const { data: stages, error: stagesError } = await client
    .from("grandtour_stages")
    .select("id, stage_number, stage_type, starts_at")
    .eq("grand_tour_id", raceId)
    .order("stage_number");
  if (stagesError) throw stagesError;
  const stageRows = stages ?? [];
  if (stageRows.length === 0) return [];
  const stageIds = stageRows.map((stage) => stage.id);
  const isTttByStageId = new Map(stageRows.map((stage) => [stage.id, isTttStageTypeValue(stage.stage_type)]));

  const { data: results, error: resultsError } = await client
    .from("grandtour_stage_results")
    .select("id, stage_id, is_final, review_status")
    .in("stage_id", stageIds);
  if (resultsError) throw resultsError;
  const resultRows = results ?? [];
  const resultByStageId = new Map(resultRows.map((row) => [row.stage_id, row]));
  const resultIds = resultRows.map((row) => row.id);

  const { data: lineRows, error: lineError } = resultIds.length > 0
    ? await client.from("grandtour_stage_result_lines").select("stage_result_id").in("stage_result_id", resultIds)
    : { data: [] as { stage_result_id: string }[], error: null };
  if (lineError) throw lineError;
  const lineCountByResultId = new Map<string, number>();
  for (const row of lineRows ?? []) {
    lineCountByResultId.set(row.stage_result_id, (lineCountByResultId.get(row.stage_result_id) ?? 0) + 1);
  }

  // Same shape, for TTT stages (see the comment on GrandTourStageReviewDetails'
  // teamLines field - a given stage result only ever has rows in one of
  // these two tables, never both).
  const { data: teamLineRows, error: teamLineError } = resultIds.length > 0
    ? await client.from("grandtour_stage_team_result_lines").select("stage_result_id").in("stage_result_id", resultIds)
    : { data: [] as { stage_result_id: string }[], error: null };
  if (teamLineError) throw teamLineError;
  const teamLineCountByResultId = new Map<string, number>();
  for (const row of teamLineRows ?? []) {
    teamLineCountByResultId.set(row.stage_result_id, (teamLineCountByResultId.get(row.stage_result_id) ?? 0) + 1);
  }

  const { data: jerseyRows, error: jerseyError } = await client
    .from("grandtour_stage_jersey_holders")
    .select("stage_id")
    .in("stage_id", stageIds);
  if (jerseyError) throw jerseyError;
  const jerseyCountByStageId = new Map<string, number>();
  for (const row of jerseyRows ?? []) {
    jerseyCountByStageId.set(row.stage_id, (jerseyCountByStageId.get(row.stage_id) ?? 0) + 1);
  }

  const { data: scoreRows, error: scoreError } = await client
    .from("grandtour_stage_scores")
    .select("stage_id, total_score, top5_score, jersey_score, bonus_score")
    .in("stage_id", stageIds);
  if (scoreError) throw scoreError;
  type ScoreAgg = { count: number; total: number; top5: number; jersey: number; bonus: number };
  const scoreAggByStageId = new Map<string, ScoreAgg>();
  for (const row of scoreRows ?? []) {
    const agg = scoreAggByStageId.get(row.stage_id) ?? { count: 0, total: 0, top5: 0, jersey: 0, bonus: 0 };
    agg.count += 1;
    agg.total += row.total_score ?? 0;
    agg.top5 += row.top5_score ?? 0;
    agg.jersey += row.jersey_score ?? 0;
    agg.bonus += row.bonus_score ?? 0;
    scoreAggByStageId.set(row.stage_id, agg);
  }

  // "Last applied/imported timestamp" comes from grandtour_feed_import_runs
  // (mode='apply'), the same audit trail apply_grandtour_official_stage_result
  // already writes to - grandtour_stage_results.updated_at isn't used for
  // this because it also changes on admin-check/finalise, which aren't
  // imports. The stage id isn't a real column on that table (only embedded
  // in its jsonb `summary`), so this is filtered via a jsonb containment
  // query rather than a plain `.eq`, but it's still a single, un-joined
  // table read.
  const { data: importRuns, error: importRunsError } = await client
    .from("grandtour_feed_import_runs")
    .select("applied_at, summary")
    .eq("mode", "apply")
    .order("applied_at", { ascending: false });
  if (importRunsError) throw importRunsError;
  const lastAppliedAtByStageId = new Map<string, string | null>();
  for (const run of importRuns ?? []) {
    const runStageId = (run.summary as { stage_id?: string } | null)?.stage_id;
    if (runStageId && !lastAppliedAtByStageId.has(runStageId)) {
      lastAppliedAtByStageId.set(runStageId, run.applied_at);
    }
  }

  return stageRows.map((stage) => {
    const result = resultByStageId.get(stage.id) ?? null;
    const agg = scoreAggByStageId.get(stage.id) ?? { count: 0, total: 0, top5: 0, jersey: 0, bonus: 0 };
    return {
      stageId: stage.id,
      stageNumber: stage.stage_number,
      stageType: stage.stage_type,
      stageDate: stage.starts_at,
      stageResultId: result?.id ?? null,
      isFinal: result?.is_final ?? false,
      reviewStatus: result?.review_status ?? null,
      // A TTT stage's result lines live in grandtour_stage_team_result_lines,
      // never grandtour_stage_result_lines - count whichever table actually
      // applies to this stage_type, so canMarkChecked/isStageDataComplete
      // (which both just compare resultLineCount === 10) work unmodified
      // for a TTT stage too.
      resultLineCount: result
        ? (isTttByStageId.get(stage.id) ? teamLineCountByResultId.get(result.id) : lineCountByResultId.get(result.id)) ?? 0
        : 0,
      jerseyHolderCount: jerseyCountByStageId.get(stage.id) ?? 0,
      scoreCount: agg.count,
      totalScoreAwarded: agg.total,
      top5ScoreAwarded: agg.top5,
      jerseyScoreAwarded: agg.jersey,
      bonusScoreAwarded: agg.bonus,
      lastAppliedAt: lastAppliedAtByStageId.get(stage.id) ?? null
    };
  });
}

export type GrandTourNotificationStatusCounts = {
  eligible: number;
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  skipped: number;
};

export type GrandTourStageNotificationSummary = {
  stageId: string;
  counts: GrandTourNotificationStatusCounts;
};

/**
 * Per-stage stage-result notification job counts for the admin screen's
 * compact notification-status section. Ordinary (non-admin) callers simply
 * get an empty result here, not an error - the underlying table's RLS
 * ("Cycling admins can read GrandTour notification jobs") already
 * restricts this to admins, so this function does no additional
 * authorization itself, matching every other read in this file.
 */
export async function listGrandTourStageNotificationSummaries(
  stageIds: string[]
): Promise<GrandTourStageNotificationSummary[]> {
  if (stageIds.length === 0) return [];
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("grandtour_stage_notification_jobs")
    .select("stage_id, status")
    .in("stage_id", stageIds);
  if (error) throw error;

  const emptyCounts = (): GrandTourNotificationStatusCounts => ({
    eligible: 0,
    pending: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    skipped: 0
  });
  const byStage = new Map<string, GrandTourNotificationStatusCounts>(
    stageIds.map((stageId) => [stageId, emptyCounts()])
  );
  for (const row of data ?? []) {
    const counts = byStage.get(row.stage_id);
    if (!counts) continue;
    counts.eligible += 1;
    if (row.status === "pending") counts.pending += 1;
    else if (row.status === "processing") counts.processing += 1;
    else if (row.status === "sent") counts.sent += 1;
    else if (row.status === "failed") counts.failed += 1;
    else if (row.status === "skipped") counts.skipped += 1;
  }
  return stageIds.map((stageId) => ({ stageId, counts: byStage.get(stageId) as GrandTourNotificationStatusCounts }));
}

export type GrandTourFailedNotificationJob = {
  id: string;
  userId: string;
  attemptCount: number;
  lastErrorCode: string | null;
  updatedAt: string;
};

/** Failed jobs for one stage, newest first - the candidate list for the retry action below. */
export async function listFailedGrandTourNotificationJobs(stageId: string): Promise<GrandTourFailedNotificationJob[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("grandtour_stage_notification_jobs")
    .select("id, user_id, attempt_count, last_error_code, updated_at")
    .eq("stage_id", stageId)
    .eq("status", "failed")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    attemptCount: row.attempt_count,
    lastErrorCode: row.last_error_code,
    updatedAt: row.updated_at
  }));
}

/**
 * Resets exactly one failed job back to pending via
 * public.retry_grandtour_stage_notification_job (admin/service-role only,
 * never touches sent/processing/pending jobs, never inserts a row - see
 * that RPC's own migration for the full guarantee).
 */
export async function retryGrandTourStageNotificationJob(jobId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.rpc("retry_grandtour_stage_notification_job", { p_job_id: jobId });
  if (error) throw error;
}

/**
 * Fetches the reviewable detail an admin needs to actually look at before
 * mark-checking a stage: the top-10 result lines (rider lines for a
 * non-TTT/unsupported-TTT stage, team lines for an individual_time TTT
 * stage - see `stageType`) and four jersey holders, with rider/team names
 * resolved. Draft (not-yet-final) rows are only readable by an admin
 * session under RLS ("Admins can manage GrandTour result lines"/"team
 * result lines"/"jersey holders" `for all` policies) - this deliberately
 * does not filter on is_final, so it works before finalisation too, which
 * is the whole point of a pre-action review step.
 *
 * `stageType` is the caller's already-loaded `grandtour_stages.stage_type`
 * (e.g. from `GrandTourStageAdminSummary.stageType`) - this function never
 * re-fetches it itself, to keep it a single-purpose, no-join-multiplication
 * read the same way listGrandTourStageAdminSummaries and the CLI's
 * fetchStageState already are.
 */
export async function getGrandTourStageAdminReviewDetails(stageId: string, stageType: string | null): Promise<GrandTourStageReviewDetails> {
  const client = getSupabaseClient();
  const isTtt = isTttStageTypeValue(stageType);

  const { data: result, error: resultError } = await client
    .from("grandtour_stage_results")
    .select("id")
    .eq("stage_id", stageId)
    .maybeSingle();
  if (resultError) throw resultError;

  const { data: lineRows, error: lineError } = result && !isTtt
    ? await client
      .from("grandtour_stage_result_lines")
      .select("actual_position, rider_id")
      .eq("stage_result_id", result.id)
      .order("actual_position")
    : { data: [] as { actual_position: number; rider_id: string }[], error: null };
  if (lineError) throw lineError;

  const { data: teamLineRows, error: teamLineError } = result && isTtt
    ? await client
      .from("grandtour_stage_team_result_lines")
      .select("actual_position, team_id")
      .eq("stage_result_id", result.id)
      .order("actual_position")
    : { data: [] as { actual_position: number; team_id: string }[], error: null };
  if (teamLineError) throw teamLineError;

  const { data: jerseyRows, error: jerseyError } = await client
    .from("grandtour_stage_jersey_holders")
    .select("jersey_type, rider_id")
    .eq("stage_id", stageId)
    .order("jersey_type");
  if (jerseyError) throw jerseyError;

  const riderIds = [...new Set([
    ...(lineRows ?? []).map((row) => row.rider_id),
    ...(jerseyRows ?? []).map((row) => row.rider_id)
  ])];

  const { data: riders, error: ridersError } = riderIds.length > 0
    ? await client.from("grandtour_riders").select("id, display_name, bib_number, team_id").in("id", riderIds)
    : { data: [] as { id: string; display_name: string; bib_number: number | null; team_id: string | null }[], error: null };
  if (ridersError) throw ridersError;

  // The stage-day bib is grandtour_stage_startlists.bib_number for this
  // specific stage when present, not the rider's canonical
  // grandtour_riders.bib_number - the two can genuinely differ (same rule
  // apps/mobile/lib/formatters.ts's preferStageBibNumber already applies
  // for tip entry/comparison screens). An admin reviewing "the top 10
  // result lines" needs to see the bib that was actually raced with.
  const { data: startlistRows, error: startlistError } = riderIds.length > 0
    ? await client.from("grandtour_stage_startlists").select("rider_id, bib_number").eq("stage_id", stageId).in("rider_id", riderIds)
    : { data: [] as { rider_id: string; bib_number: number | null }[], error: null };
  if (startlistError) throw startlistError;

  const teamLineTeamIds = (teamLineRows ?? []).map((row) => row.team_id);
  const teamIds = [...new Set([
    ...(riders ?? []).flatMap((rider) => rider.team_id ? [rider.team_id] : []),
    ...teamLineTeamIds
  ])];
  const { data: teams, error: teamsError } = teamIds.length > 0
    ? await client.from("grandtour_teams").select("id, name").in("id", teamIds)
    : { data: [] as { id: string; name: string }[], error: null };
  if (teamsError) throw teamsError;

  const riderById = new Map((riders ?? []).map((rider) => [rider.id, rider]));
  const teamNameById = new Map((teams ?? []).map((team) => [team.id, team.name]));
  const stageBibByRiderId = new Map((startlistRows ?? []).map((row) => [row.rider_id, row.bib_number]));

  const resolveRider = (riderId: string) => {
    const rider = riderById.get(riderId);
    const stageBib = stageBibByRiderId.get(riderId);
    return {
      bibNumber: stageBib ?? rider?.bib_number ?? null,
      riderName: rider?.display_name ?? "Unknown rider",
      teamName: rider?.team_id ? teamNameById.get(rider.team_id) ?? null : null
    };
  };

  return {
    lines: (lineRows ?? []).map((row) => ({ position: row.actual_position, riderId: row.rider_id, ...resolveRider(row.rider_id) })),
    teamLines: (teamLineRows ?? []).map((row) => ({
      position: row.actual_position,
      teamId: row.team_id,
      teamName: teamNameById.get(row.team_id) ?? "Unknown team"
    })),
    jerseyHolders: (jerseyRows ?? []).map((row) => ({ jerseyType: row.jersey_type, riderId: row.rider_id, ...resolveRider(row.rider_id) }))
  };
}

function buildGrandTourAdminRequestId(action: string, stageNumber: number): string {
  return `${action}-stage${stageNumber}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

export async function markGrandTourStageChecked(input: {
  stageId: string;
  stageNumber: number;
  checkedBy: string;
  note?: string | null;
  requestId?: string | null;
}): Promise<unknown> {
  const { data, error } = await getSupabaseClient().rpc("mark_grandtour_stage_result_checked", {
    p_stage_id: input.stageId,
    p_checked_by: input.checkedBy,
    p_note: input.note ?? undefined,
    p_request_id: input.requestId ?? buildGrandTourAdminRequestId("mark-checked", input.stageNumber)
  });
  if (error) throw error;
  return data;
}

export async function finalizeGrandTourStage(input: {
  stageId: string;
  stageNumber: number;
  finalizedBy: string;
  reason?: string | null;
  requestId?: string | null;
}): Promise<unknown> {
  const { data, error } = await getSupabaseClient().rpc("finalize_grandtour_stage_result", {
    p_stage_id: input.stageId,
    p_finalized_by: input.finalizedBy,
    p_reason: input.reason ?? undefined,
    p_request_id: input.requestId ?? buildGrandTourAdminRequestId("finalise", input.stageNumber)
  });
  if (error) throw error;
  return data;
}

export async function scoreGrandTourStage(input: {
  stageId: string;
  stageNumber: number;
  reason?: string | null;
  requestId?: string | null;
}): Promise<unknown> {
  const { data, error } = await getSupabaseClient().rpc("recalculate_grandtour_stage_scores", {
    p_stage_id: input.stageId,
    p_reason: input.reason ?? undefined,
    p_request_id: input.requestId ?? buildGrandTourAdminRequestId("score", input.stageNumber)
  });
  if (error) throw error;
  return data;
}

/**
 * Corrects an EXISTING stage result (draft or already finalised/scored)
 * from a freshly reviewed report - calls
 * correct_grandtour_stage_result_from_reviewed_report, never writes to any
 * table directly. p_reason is required by the RPC itself (refuses a blank
 * reason); this wrapper does not duplicate that check, it just passes
 * whatever the caller supplied straight through so the RPC's own error
 * message is what the UI surfaces.
 */
export async function correctGrandTourStageResult(input: {
  stageId: string;
  stageNumber: number;
  resultLines: { rider_id: string; actual_position: number }[];
  jerseyHolders: { jersey_type: "yellow" | "green" | "kom" | "white"; rider_id: string }[];
  reconciliation: Json;
  reason: string;
  requestId?: string | null;
}): Promise<unknown> {
  const { data, error } = await getSupabaseClient().rpc("correct_grandtour_stage_result_from_reviewed_report", {
    p_stage_id: input.stageId,
    p_result_lines: input.resultLines,
    p_jersey_holders: input.jerseyHolders,
    p_reconciliation: input.reconciliation,
    p_reason: input.reason,
    p_request_id: input.requestId ?? buildGrandTourAdminRequestId("update-results", input.stageNumber)
  });
  if (error) throw error;
  return data;
}

export type GrandTourOfficialCheckParsedRider = {
  position: number;
  rider_name: string;
  bib_number: number | null;
  team_name: string;
  time?: string | null;
  gap?: string | null;
};

export type GrandTourOfficialCheckJerseyHolder = {
  jerseyType: "yellow" | "green" | "kom" | "white";
  sourceClassification: string | null;
  parsedRiderName: string | null;
  parsedTeamName: string | null;
  bibNumber: number | null;
  matchedRiderId: string | null;
  matchedBy: string | null;
  nameMismatch: boolean;
  teamMismatch: boolean;
  onStartlist: boolean;
  status: string;
};

export type GrandTourOfficialCheckTeamResult = {
  position: number;
  teamId: string | null;
  teamName: string;
};

export type GrandTourOfficialCheckStageReconciliation = {
  stageNumber: number;
  safeToApply: boolean;
  blockers: string[];
  parsedRiders: GrandTourOfficialCheckParsedRider[];
  matchedRiders: { riderName: string; bibNumber: number | null; riderId: string | null }[];
  jerseyHolders: GrandTourOfficialCheckJerseyHolder[];
  // Only meaningful for a TTT stage (isTtt below) - the derived,
  // team-matched result from reconcileTeamTimeTrialResult, present
  // regardless of whether this TTT stage is actually apply-eligible
  // (isSupportedTtt/ttt_timing_rule), same as the report shape
  // reconcileStageResult itself produces.
  isTtt?: boolean;
  isSupportedTtt?: boolean;
  tttTeamResult?: { teams: GrandTourOfficialCheckTeamResult[]; blockers: string[] };
};

export type GrandTourOfficialCheckJerseyFetchMetadata = {
  stageNumber: number;
  classification: string;
  jerseyType: string;
  status: string;
};

export type GrandTourOfficialCheckStageFetchMetadata = {
  stageNumber: number;
  status: string;
  rowsMatched: number;
  ridersParsed: number;
};

export type GrandTourOfficialCheckReport = {
  fetchedAt: string | null;
  fromStage: number | null;
  toStage: number | null;
  provider: string;
  parserDriftDetected: boolean;
  stageFetchMetadata: GrandTourOfficialCheckStageFetchMetadata[];
  jerseyFetchMetadata: GrandTourOfficialCheckJerseyFetchMetadata[];
  reconciliation?: {
    overallSafeToApply: boolean;
    stages: GrandTourOfficialCheckStageReconciliation[];
  };
};

/**
 * Calls the server-side POST /api/admin/grandtour/run-official-check route
 * (apps/mobile/api/admin/grandtour/run-official-check.mjs) - dry-run +
 * reconcile only, preview-only, never applies/finalises/scores anything.
 * The scraper never runs in browser code; this only ever sends the
 * caller's own session access token (never a service-role key) so the
 * server route can verify admin access before running the check.
 *
 * Only reachable on the web deployment (relative /api/... routes resolve
 * against the current origin, i.e. the Vercel deployment) - native
 * iOS/Android builds have no equivalent server route available to them.
 */
export async function runGrandTourOfficialCheck(input: {
  grandTourName: string;
  grandTourYear: number;
  stageNumber: number;
  provider?: string;
}): Promise<GrandTourOfficialCheckReport> {
  const session = await getCurrentSession();
  if (!session?.access_token) {
    throw new Error("You must be signed in to run an official check.");
  }

  const response = await fetch("/api/admin/grandtour/run-official-check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({
      grandTourName: input.grandTourName,
      grandTourYear: input.grandTourYear,
      stageNumber: input.stageNumber,
      provider: input.provider ?? "official-letour"
    })
  });

  let body: { ok?: boolean; report?: GrandTourOfficialCheckReport; error?: string } | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok) {
    throw new Error(body?.error ?? `Official check failed (HTTP ${response.status}).`);
  }

  return body.report as GrandTourOfficialCheckReport;
}

export type GrandTourApplyOfficialResultOutcome = {
  status: string;
  message: string;
  data: unknown;
};

/**
 * Calls the server-side POST /api/admin/grandtour/apply-official-result
 * route (apps/mobile/api/admin/grandtour/apply-official-result.mjs) -
 * fetches a fresh official result for the stage, validates it, and applies
 * it as a draft using the caller's own session (never a service-role key).
 * Writes a draft result only - never finalises, never scores. Throws on
 * any non-2xx response (validation failure, RPC error, auth failure), with
 * the server's error message.
 */
export async function applyGrandTourOfficialResult(input: {
  grandTourName: string;
  grandTourYear: number;
  stageNumber: number;
  provider?: string;
  reason?: string;
}): Promise<GrandTourApplyOfficialResultOutcome> {
  const session = await getCurrentSession();
  if (!session?.access_token) {
    throw new Error("You must be signed in to apply an official result.");
  }

  const response = await fetch("/api/admin/grandtour/apply-official-result", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({
      grandTourName: input.grandTourName,
      grandTourYear: input.grandTourYear,
      stageNumber: input.stageNumber,
      provider: input.provider ?? "official-letour",
      reason: input.reason ?? undefined
    })
  });

  let body: { ok?: boolean; status?: string; message?: string; data?: unknown; error?: string } | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok) {
    throw new Error(body?.error ?? body?.message ?? `Apply failed (HTTP ${response.status}).`);
  }

  return { status: body.status ?? "applied", message: body.message ?? "Applied.", data: body.data ?? null };
}
