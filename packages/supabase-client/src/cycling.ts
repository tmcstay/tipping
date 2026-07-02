import { getSupabaseClient } from "./client";
import { getCurrentUser } from "./auth";
import type {
  GrandTourTipMode,
  GrandTourTipScope,
  GrandTourTipSelectionInput,
  GrandTourTipStatus,
  Json
} from "@tipping-suite/shared-types";

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
  is_public: boolean;
  active_jersey_types: ("yellow" | "green" | "kom" | "white")[];
  allow_preselection: boolean;
  allow_daily: boolean;
};

export type CyclingTeam = {
  id: string;
  name: string;
  code: string | null;
  country: string | null;
  team_type: string | null;
  data_confidence: string;
};

export type CyclingRider = {
  id: string;
  team_id: string | null;
  display_name: string;
  normalized_name: string;
  nationality: string | null;
  rider_type: string | null;
  data_confidence: string;
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
  is_dummy: boolean;
  is_prize_eligible: boolean;
  display_name: string;
};

export type GrandTourTipSelection = GrandTourTipSelectionInput & { id: string };

export type GrandTourScore = {
  id: string;
  top5_score: number;
  jersey_score: number;
  bonus_score: number;
  total_score: number;
  score_details: Json;
  scored_at: string;
  is_prize_eligible: boolean;
};

export type GrandTourTipRecord = {
  id: string;
  user_id: string;
  competition_id: string;
  stage_id: string | null;
  tip_mode: GrandTourTipMode;
  tip_scope: GrandTourTipScope;
  status: GrandTourTipStatus;
  submitted_at: string | null;
  locked_at: string | null;
  total_score: number;
  is_dummy: boolean;
  updated_at: string;
  selections: GrandTourTipSelection[];
  score: GrandTourScore | null;
};

export type LeagueTipComparison = GrandTourTipRecord & {
  display_name: string;
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

export async function listCyclingTeams(raceId: string): Promise<CyclingTeam[]> {
  const { data, error } = await getSupabaseClient()
    .from("grandtour_teams")
    .select("id,name,code,country,team_type,data_confidence")
    .eq("grand_tour_id", raceId)
    .order("name", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function listCyclingRiders(raceId: string): Promise<CyclingRider[]> {
  const { data, error } = await getSupabaseClient()
    .from("grandtour_riders")
    .select("id,team_id,display_name,normalized_name,nationality,rider_type,data_confidence")
    .eq("grand_tour_id", raceId)
    .eq("is_active", true)
    .order("display_name", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getPublicCyclingCompetition(
  raceId: string
): Promise<CyclingCompetition | null> {
  const { data, error } = await getSupabaseClient()
    .from("grandtour_competitions")
    .select("id,grand_tour_id,name,is_public,active_jersey_types,allow_preselection,allow_daily")
    .eq("grand_tour_id", raceId)
    .eq("is_public", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function listCyclingCompetitions(raceId: string): Promise<CyclingCompetition[]> {
  const { data, error } = await getSupabaseClient()
    .from("grandtour_competitions")
    .select("id,grand_tour_id,name,is_public,active_jersey_types,allow_preselection,allow_daily")
    .eq("grand_tour_id", raceId)
    .order("is_public", { ascending: false })
    .order("name", { ascending: true });

  if (error) throw error;
  return data ?? [];
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

async function hydrateTips(
  tips: Omit<GrandTourTipRecord, "selections" | "score">[]
): Promise<GrandTourTipRecord[]> {
  if (tips.length === 0) return [];
  const client = getSupabaseClient();
  const tipIds = tips.map((tip) => tip.id);
  const [{ data: selections, error: selectionsError }, { data: scores, error: scoresError }] =
    await Promise.all([
      client
        .from("grandtour_tip_selections")
        .select("id,tip_id,selection_type,rider_id,predicted_position")
        .in("tip_id", tipIds),
      client
        .from("grandtour_stage_scores")
        .select("id,tip_id,top5_score,jersey_score,bonus_score,total_score,score_details,scored_at,is_prize_eligible")
        .in("tip_id", tipIds)
    ]);
  if (selectionsError) throw selectionsError;
  if (scoresError) throw scoresError;

  return tips.map((tip) => ({
    ...tip,
    selections: (selections ?? [])
      .filter((selection) => selection.tip_id === tip.id)
      .map(({ tip_id: _tipId, ...selection }) => selection),
    score: (scores ?? []).find((score) => score.tip_id === tip.id) ?? null
  }));
}

const tipColumns = "id,user_id,competition_id,stage_id,tip_mode,tip_scope,status,submitted_at,locked_at,total_score,is_dummy,updated_at" as const;

export async function getCurrentUserGrandTourTip(input: {
  competitionId: string;
  stageId: string | null;
  tipMode: GrandTourTipMode;
  tipScope: GrandTourTipScope;
}): Promise<GrandTourTipRecord | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  let query = getSupabaseClient()
    .from("grandtour_tips")
    .select(tipColumns)
    .eq("user_id", user.id)
    .eq("competition_id", input.competitionId)
    .eq("tip_mode", input.tipMode)
    .eq("tip_scope", input.tipScope);
  query = input.stageId === null ? query.is("stage_id", null) : query.eq("stage_id", input.stageId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return (await hydrateTips([data]))[0] ?? null;
}

export async function saveGrandTourTipDraft(input: {
  competitionId: string;
  stageId: string | null;
  tipMode: GrandTourTipMode;
  tipScope: GrandTourTipScope;
  selections: GrandTourTipSelectionInput[];
}): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("save_grandtour_tip_draft", {
    p_competition_id: input.competitionId,
    p_stage_id: input.stageId,
    p_tip_mode: input.tipMode,
    p_tip_scope: input.tipScope,
    p_selections: input.selections,
    p_request_id: globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}`
  });
  if (error) throw error;
  return data;
}

export async function submitGrandTourTip(tipId: string) {
  const { data, error } = await getSupabaseClient().rpc("submit_grandtour_tip", {
    p_tip_id: tipId,
    p_request_id: globalThis.crypto?.randomUUID?.() ?? `submit-${Date.now()}`
  });
  if (error) throw error;
  return data;
}

export async function clearGrandTourTip(tipId: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("clear_grandtour_tip_draft", {
    p_tip_id: tipId,
    p_reason: "Cleared by user",
    p_request_id: globalThis.crypto?.randomUUID?.() ?? `clear-${Date.now()}`
  });
  if (error) throw error;
  return data;
}

export async function listLeagueTipsAfterLock(input: {
  competitionId: string;
  stageId: string | null;
  tipMode: GrandTourTipMode;
  tipScope: GrandTourTipScope;
}): Promise<LeagueTipComparison[]> {
  let query = getSupabaseClient()
    .from("grandtour_tips")
    .select(tipColumns)
    .eq("competition_id", input.competitionId)
    .eq("tip_mode", input.tipMode)
    .eq("tip_scope", input.tipScope)
    .in("status", ["submitted", "locked", "scored", "corrected"]);
  query = input.stageId === null ? query.is("stage_id", null) : query.eq("stage_id", input.stageId);
  const { data, error } = await query.order("submitted_at", { ascending: true });
  if (error) throw error;
  const tips = await hydrateTips(data ?? []);
  if (tips.length === 0) return [];
  const { data: profiles, error: profileError } = await getSupabaseClient()
    .from("grandtour_league_profiles")
    .select("id,display_name,is_dummy")
    .in("id", tips.map((tip) => tip.user_id));
  if (profileError) throw profileError;
  return tips.map((tip) => ({
    ...tip,
    display_name: profiles?.find((profile) => profile.id === tip.user_id)?.display_name ?? `Entry ${tip.user_id.slice(0, 8)}`
  }));
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
    .select("id,user_id,leaderboard_type,rank,total_score,stages_tipped,last_stage_score,snapshot_at,is_dummy,is_prize_eligible")
    .eq("competition_id", competitionId)
    .eq("leaderboard_type", leaderboardType)
    .eq("snapshot_at", latest.snapshot_at)
    .order("rank", { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const { data: profiles, error: profileError } = await client
    .from("grandtour_league_profiles")
    .select("id,display_name,is_dummy")
    .in("id", rows.map((row) => row.user_id));
  if (profileError) throw profileError;
  return rows.map((row) => {
    const profile = profiles?.find((candidate) => candidate.id === row.user_id);
    return {
      ...row,
      is_dummy: row.is_dummy || profile?.is_dummy === true,
      display_name: profile?.display_name ?? `Entry ${row.user_id.slice(0, 8)}`
    };
  }) as CyclingLeaderboardRow[];
}
