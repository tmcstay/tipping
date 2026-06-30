import { getCurrentUser } from "./auth";
import { getSupabaseClient } from "./client";

export type CyclingRace = {
  id: string;
  name: string;
  year: number;
  starts_at: string | null;
  ends_at: string | null;
  preselection_locks_at: string;
  category: string | null;
  countries: string[];
  source_url: string | null;
  data_confidence: string;
};

export type CyclingStage = {
  id: string;
  grand_tour_id: string;
  stage_number: number;
  stage_name: string | null;
  stage_type: string;
  starts_at: string;
  locks_at: string;
  start_location: string | null;
  finish_location: string | null;
  distance_km: number | null;
  start_time_is_estimated: boolean;
  source_url: string | null;
  data_confidence: string;
};

export type CyclingCompetition = {
  id: string;
  grand_tour_id: string;
  name: string;
  allow_preselection: boolean;
  allow_daily: boolean;
};

export type CyclingStartlistRider = {
  id: string;
  status: string;
  bib_number: number | null;
  rider_role: string | null;
  rider: {
    id: string;
    display_name: string;
    nationality: string | null;
    rider_type: string | null;
  };
  team: {
    id: string;
    name: string;
    code: string | null;
  } | null;
};

export type CyclingLeaderboardRow = {
  id: string;
  user_id: string;
  leaderboard_type: "daily" | "preselection" | "overall";
  rank: number;
  total_score: number;
  stages_tipped: number;
  last_stage_score: number | null;
  snapshot_at: string;
};

export async function getCyclingRaceByYear(year = 2026): Promise<CyclingRace | null> {
  const { data, error } = await getSupabaseClient()
    .from("grand_tours")
    .select("id,name,year,starts_at,ends_at,preselection_locks_at,category,countries,source_url,data_confidence")
    .eq("sport", "cycling")
    .eq("year", year)
    .not("source_url", "is", null)
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function listCyclingStages(raceId: string): Promise<CyclingStage[]> {
  const { data, error } = await getSupabaseClient()
    .from("grandtour_stages")
    .select("id,grand_tour_id,stage_number,stage_name,stage_type,starts_at,locks_at,start_location,finish_location,distance_km,start_time_is_estimated,source_url,data_confidence")
    .eq("grand_tour_id", raceId)
    .order("stage_number", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getPublicCyclingCompetition(
  raceId: string
): Promise<CyclingCompetition | null> {
  const { data, error } = await getSupabaseClient()
    .from("grandtour_competitions")
    .select("id,grand_tour_id,name,allow_preselection,allow_daily")
    .eq("grand_tour_id", raceId)
    .eq("is_public", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function listStageStartlist(stageId: string): Promise<CyclingStartlistRider[]> {
  const { data, error } = await getSupabaseClient()
    .from("grandtour_stage_startlists")
    .select("id,status,bib_number,rider_role,grandtour_riders!inner(id,display_name,nationality,rider_type),grandtour_teams(id,name,code)")
    .eq("stage_id", stageId)
    .in("status", ["provisional", "confirmed"])
    .order("status", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(({ grandtour_riders, grandtour_teams, ...row }) => ({
    ...row,
    rider: Array.isArray(grandtour_riders) ? grandtour_riders[0] : grandtour_riders,
    team: Array.isArray(grandtour_teams) ? grandtour_teams[0] ?? null : grandtour_teams
  }));
}

export async function saveCurrentUserCyclingStageWinnerTip(input: {
  competitionId: string;
  stageId: string;
  riderId: string;
}): Promise<{ tipId: string }> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You need to sign in before submitting tips.");

  const client = getSupabaseClient();
  const { data: existingTip, error: existingTipError } = await client
    .from("grandtour_tips")
    .select("id")
    .eq("user_id", user.id)
    .eq("competition_id", input.competitionId)
    .eq("stage_id", input.stageId)
    .eq("tip_mode", "daily")
    .maybeSingle();
  if (existingTipError) throw existingTipError;

  let tipId = existingTip?.id;
  if (!tipId) {
    const { data, error } = await client
      .from("grandtour_tips")
      .insert({
        user_id: user.id,
        competition_id: input.competitionId,
        stage_id: input.stageId,
        tip_mode: "daily",
        status: "draft"
      })
      .select("id")
      .single();
    if (error) throw error;
    tipId = data.id;
  }

  const { data: existingSelection, error: selectionLookupError } = await client
    .from("grandtour_tip_selections")
    .select("id")
    .eq("tip_id", tipId)
    .eq("selection_type", "stage_top_5")
    .eq("predicted_position", 1)
    .maybeSingle();
  if (selectionLookupError) throw selectionLookupError;

  if (existingSelection) {
    const { error } = await client
      .from("grandtour_tip_selections")
      .update({ rider_id: input.riderId })
      .eq("id", existingSelection.id);
    if (error) throw error;
  } else {
    const { error } = await client.from("grandtour_tip_selections").insert({
      tip_id: tipId,
      selection_type: "stage_top_5",
      rider_id: input.riderId,
      predicted_position: 1
    });
    if (error) throw error;
  }

  return { tipId };
}

export async function getCurrentUserCyclingStageWinnerTip(input: {
  competitionId: string;
  stageId: string;
}): Promise<{ riderId: string; tipId: string } | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const client = getSupabaseClient();
  const { data: tip, error: tipError } = await client
    .from("grandtour_tips")
    .select("id")
    .eq("user_id", user.id)
    .eq("competition_id", input.competitionId)
    .eq("stage_id", input.stageId)
    .eq("tip_mode", "daily")
    .maybeSingle();
  if (tipError) throw tipError;
  if (!tip) return null;

  const { data: selection, error: selectionError } = await client
    .from("grandtour_tip_selections")
    .select("rider_id")
    .eq("tip_id", tip.id)
    .eq("selection_type", "stage_top_5")
    .eq("predicted_position", 1)
    .maybeSingle();
  if (selectionError) throw selectionError;
  return selection ? { riderId: selection.rider_id, tipId: tip.id } : null;
}

export async function listCyclingLeaderboard(
  competitionId: string,
  leaderboardType: CyclingLeaderboardRow["leaderboard_type"] = "overall"
): Promise<CyclingLeaderboardRow[]> {
  const client = getSupabaseClient();
  const { data: latest, error: latestError } = await client
    .from("grandtour_leaderboard_snapshots")
    .select("snapshot_at")
    .eq("competition_id", competitionId)
    .eq("leaderboard_type", leaderboardType)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  if (!latest) return [];

  const { data, error } = await client
    .from("grandtour_leaderboard_snapshots")
    .select("id,user_id,leaderboard_type,rank,total_score,stages_tipped,last_stage_score,snapshot_at")
    .eq("competition_id", competitionId)
    .eq("leaderboard_type", leaderboardType)
    .eq("snapshot_at", latest.snapshot_at)
    .order("rank", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CyclingLeaderboardRow[];
}
