import type { Json } from "@tipping-suite/shared-types";

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

export type GrandTourAdminJerseyHolder = {
  jerseyType: "yellow" | "green" | "kom" | "white";
  riderId: string;
  bibNumber: number | null;
  riderName: string;
  teamName: string | null;
};

export type GrandTourStageReviewDetails = {
  lines: GrandTourAdminResultLine[];
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
      resultLineCount: result ? lineCountByResultId.get(result.id) ?? 0 : 0,
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

/**
 * Fetches the reviewable detail an admin needs to actually look at before
 * mark-checking a stage: the top-10 result lines and four jersey holders,
 * with rider/team names resolved. Draft (not-yet-final) rows are only
 * readable by an admin session under RLS ("Admins can manage GrandTour
 * result lines"/"jersey holders" `for all` policies) - this deliberately
 * does not filter on is_final, so it works before finalisation too, which
 * is the whole point of a pre-action review step.
 *
 * Every query here is scoped to a single table (grandtour_stage_results,
 * grandtour_stage_result_lines, grandtour_stage_jersey_holders,
 * grandtour_riders, grandtour_teams), resolved and joined client-side -
 * the same no-join-multiplication approach as listGrandTourStageAdminSummaries
 * and the CLI's fetchStageState.
 */
export async function getGrandTourStageAdminReviewDetails(stageId: string): Promise<GrandTourStageReviewDetails> {
  const client = getSupabaseClient();

  const { data: result, error: resultError } = await client
    .from("grandtour_stage_results")
    .select("id")
    .eq("stage_id", stageId)
    .maybeSingle();
  if (resultError) throw resultError;

  const { data: lineRows, error: lineError } = result
    ? await client
      .from("grandtour_stage_result_lines")
      .select("actual_position, rider_id")
      .eq("stage_result_id", result.id)
      .order("actual_position")
    : { data: [] as { actual_position: number; rider_id: string }[], error: null };
  if (lineError) throw lineError;

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

  const teamIds = [...new Set((riders ?? []).flatMap((rider) => rider.team_id ? [rider.team_id] : []))];
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
