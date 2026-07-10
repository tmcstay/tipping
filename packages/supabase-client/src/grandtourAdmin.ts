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
    .select("id, stage_number")
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

  return stageRows.map((stage) => {
    const result = resultByStageId.get(stage.id) ?? null;
    const agg = scoreAggByStageId.get(stage.id) ?? { count: 0, total: 0, top5: 0, jersey: 0, bonus: 0 };
    return {
      stageId: stage.id,
      stageNumber: stage.stage_number,
      stageResultId: result?.id ?? null,
      isFinal: result?.is_final ?? false,
      reviewStatus: result?.review_status ?? null,
      resultLineCount: result ? lineCountByResultId.get(result.id) ?? 0 : 0,
      jerseyHolderCount: jerseyCountByStageId.get(stage.id) ?? 0,
      scoreCount: agg.count,
      totalScoreAwarded: agg.total,
      top5ScoreAwarded: agg.top5,
      jerseyScoreAwarded: agg.jersey,
      bonusScoreAwarded: agg.bonus
    };
  });
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
