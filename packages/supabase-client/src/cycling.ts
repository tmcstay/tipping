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
  ttt_timing_rule: "team_time" | "individual_time" | null;
  manual_locked_at: string | null;
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
  bib_number: number | null;
  display_name: string;
  normalized_name: string;
  nationality: string | null;
  rider_type: string | null;
  specialities: string[] | null;
  data_confidence: string;
};

export type CyclingStartlistRider = {
  id: string;
  status: string;
  bib_number: number | null;
  rider_role: string | null;
  status_changed_at: string | null;
  status_reason: string | null;
  rider: {
    id: string;
    bib_number: number | null;
    display_name: string;
    nationality: string | null;
    rider_type: string | null;
    specialities: string[] | null;
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
  /** Rank as of the previous completed stage's scoring, or null if the user has no scored stage before the most recent one (rendered as "New" by the caller). */
  previous_rank: number | null;
  total_score: number;
  stages_tipped: number;
  last_stage_score: number | null;
  snapshot_at: string;
  is_dummy: boolean;
  is_prize_eligible: boolean;
  display_name: string;
};

export type CyclingStageResult = {
  id: string;
  stage_id: string;
  riderResults: {
    actual_position: number;
    rider: {
      id: string;
      display_name: string;
      bib_number: number | null;
      team: { id: string; name: string; code: string | null } | null;
    };
  }[];
  teamResults: {
    actual_position: number;
    team: { id: string; name: string };
  }[];
  jerseyResults: {
    jersey_type: "yellow" | "green" | "kom" | "white";
    rider: {
      id: string;
      display_name: string;
      bib_number: number | null;
      team: { id: string; name: string; code: string | null } | null;
    };
  }[];
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

export async function getGrandTourTipEntryAvailability(): Promise<boolean> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("apps")
    .select("grandtour_tipping_enabled")
    .eq("code", "cycling")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data?.grandtour_tipping_enabled === true;
}

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
    .select("id,grand_tour_id,stage_number,stage_name,stage_type,ttt_timing_rule,manual_locked_at,starts_at,locks_at,start_location,finish_location,distance_km,start_time_is_estimated,source_url,data_confidence")
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
    .select("id,team_id,bib_number,display_name,normalized_name,nationality,rider_type,specialities,data_confidence")
    .eq("grand_tour_id", raceId)
    .eq("is_active", true)
    .order("display_name", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export type GrandTourDirectoryRider = {
  id: string;
  teamId: string | null;
  bibNumber: number | null;
  displayName: string;
  isActive: boolean;
  status: string | null;
};

/**
 * Every rider for a grand tour, including inactive/scratched ones - unlike
 * listCyclingRiders (which deliberately excludes inactive riders, since
 * that function feeds stage tip-entry pickers where an inactive rider
 * shouldn't be selectable at all). The rider directory and favourites
 * screens need to keep showing a rider after they become inactive
 * (Part D requirement: "still show them but label inactive"), so this is
 * a separate function rather than a flag added to listCyclingRiders, to
 * avoid ever accidentally loosening what's selectable for a stage tip.
 */
export async function listAllGrandTourRiders(raceId: string): Promise<GrandTourDirectoryRider[]> {
  const { data, error } = await getSupabaseClient()
    .from("grandtour_riders")
    .select("id,team_id,bib_number,display_name,is_active,status")
    .eq("grand_tour_id", raceId)
    .order("display_name", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    teamId: row.team_id,
    bibNumber: row.bib_number,
    displayName: row.display_name,
    isActive: row.is_active,
    status: row.status
  }));
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
    .select("id,status,bib_number,rider_role,status_changed_at,status_reason,grandtour_riders!inner(id,bib_number,display_name,nationality,rider_type,specialities),grandtour_teams(id,name,code)")
    .eq("stage_id", stageId)
    .order("status", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(({ grandtour_riders, grandtour_teams, ...row }) => ({
    ...row,
    rider: Array.isArray(grandtour_riders) ? grandtour_riders[0] : grandtour_riders,
    team: Array.isArray(grandtour_teams) ? grandtour_teams[0] ?? null : grandtour_teams
  }));
}

/**
 * Both result queries below filter `is_final = true` (already RLS-enforced
 * for the anon/publishable key regardless - see the RLS note in
 * hydrateCyclingStageResults' callers) AND `grandtour_stages.starts_at <=
 * now`, as the earliest-reliable-layer defensive filter from
 * isStageEligibleForResults (packages/tipping-core/src/stage-eligibility.ts)
 * - a stage row existing (or even an is_final row existing, in the event of
 * bad/test data) is never treated as a real, displayable result if its
 * scheduled start is still in the future. `now` is injectable for tests;
 * defaults to the real clock.
 */
export async function getCyclingStageResult(
  stageId: string,
  now: Date = new Date()
): Promise<CyclingStageResult | null> {
  const client = getSupabaseClient();
  const { data: result, error: resultError } = await client
    .from("grandtour_stage_results")
    .select("id,stage_id,grandtour_stages!inner(starts_at)")
    .eq("stage_id", stageId)
    .eq("is_final", true)
    .lte("grandtour_stages.starts_at", now.toISOString())
    .maybeSingle();
  if (resultError) throw resultError;
  if (!result) return null;

  const { grandtour_stages: _stage, ...bareResult } = result;
  return (await hydrateCyclingStageResults([bareResult]))[0] ?? null;
}

export async function listCyclingStageResults(
  raceId: string,
  now: Date = new Date()
): Promise<CyclingStageResult[]> {
  const { data, error } = await getSupabaseClient()
    .from("grandtour_stage_results")
    .select("id,stage_id,grandtour_stages!inner(grand_tour_id,starts_at)")
    .eq("grandtour_stages.grand_tour_id", raceId)
    .eq("is_final", true)
    .lte("grandtour_stages.starts_at", now.toISOString());
  if (error) throw error;
  return hydrateCyclingStageResults((data ?? []).map(({ grandtour_stages: _stage, ...result }) => result));
}

async function hydrateCyclingStageResults(
  results: { id: string; stage_id: string }[]
): Promise<CyclingStageResult[]> {
  if (results.length === 0) return [];
  const client = getSupabaseClient();
  const resultIds = results.map((result) => result.id);
  const stageIds = results.map((result) => result.stage_id);

  const [
    { data: riderLines, error: riderLineError },
    { data: teamLines, error: teamError },
    { data: jerseyLines, error: jerseyError }
  ] = await Promise.all([
    client
      .from("grandtour_stage_result_lines")
      .select("stage_result_id,actual_position,rider_id")
      .in("stage_result_id", resultIds)
      .order("actual_position", { ascending: true }),
    client
      .from("grandtour_stage_team_result_lines")
      .select("stage_result_id,actual_position,team_id")
      .in("stage_result_id", resultIds)
      .order("actual_position", { ascending: true }),
    client
      .from("grandtour_stage_jersey_holders")
      .select("stage_id,jersey_type,rider_id")
      .in("stage_id", stageIds)
  ]);
  if (riderLineError) throw riderLineError;
  if (teamError) throw teamError;
  if (jerseyError) throw jerseyError;

  const teamIds = (teamLines ?? []).map((line) => line.team_id);
  const riderIds = [
    ...(riderLines ?? []).map((line) => line.rider_id),
    ...(jerseyLines ?? []).map((line) => line.rider_id)
  ];
  const [{ data: teams, error: teamsError }, { data: riders, error: ridersError }] = await Promise.all([
    teamIds.length
      ? client.from("grandtour_teams").select("id,name,code").in("id", teamIds)
      : Promise.resolve({ data: [], error: null }),
    riderIds.length
      ? client.from("grandtour_riders").select("id,display_name,team_id,bib_number").in("id", riderIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (teamsError) throw teamsError;
  if (ridersError) throw ridersError;
  const riderTeamIds = (riders ?? [])
    .map((rider) => rider.team_id)
    .filter((teamId): teamId is string => teamId !== null && !teamIds.includes(teamId));
  const { data: riderTeams, error: riderTeamsError } = riderTeamIds.length
    ? await client.from("grandtour_teams").select("id,name,code").in("id", riderTeamIds)
    : { data: [], error: null };
  if (riderTeamsError) throw riderTeamsError;
  const allTeams = [...(teams ?? []), ...(riderTeams ?? [])];

  const riderWithTeam = (riderId: string) => {
    const rider = riders?.find((candidate) => candidate.id === riderId);
    if (!rider) return null;
    const team = allTeams.find((candidate) => candidate.id === rider.team_id) ?? null;
    return { id: rider.id, display_name: rider.display_name, bib_number: rider.bib_number, team };
  };

  return results.map((result) => ({
    id: result.id,
    stage_id: result.stage_id,
    riderResults: (riderLines ?? [])
      .filter((line) => line.stage_result_id === result.id)
      .flatMap((line) => {
        const rider = riderWithTeam(line.rider_id);
        return rider ? [{ actual_position: line.actual_position, rider }] : [];
      }),
    teamResults: (teamLines ?? [])
      .filter((line) => line.stage_result_id === result.id)
      .flatMap((line) => {
        const team = allTeams.find((candidate) => candidate.id === line.team_id);
        return team ? [{ actual_position: line.actual_position, team }] : [];
      }),
    jerseyResults: (jerseyLines ?? [])
      .filter((line) => line.stage_id === result.stage_id)
      .flatMap((line) => {
        const rider = riderWithTeam(line.rider_id);
        return rider ? [{ jersey_type: line.jersey_type, rider }] : [];
      })
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
        .select("id,tip_id,selection_type,rider_id,team_id,predicted_position")
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
      .flatMap(({ tip_id: _tipId, ...selection }): GrandTourTipSelection[] => {
        if (selection.selection_type === "stage_top_5") {
          if (selection.predicted_position === null) return [];
          if (selection.team_id) return [{
            ...selection,
            selection_type: "stage_top_5",
            rider_id: null,
            team_id: selection.team_id,
            predicted_position: selection.predicted_position
          }];
          if (selection.rider_id) return [{
            ...selection,
            selection_type: "stage_top_5",
            rider_id: selection.rider_id,
            team_id: null,
            predicted_position: selection.predicted_position
          }];
          return [];
        }
        if (!selection.rider_id) return [];
        const selectionType = selection.selection_type;
        return [{
          ...selection,
          selection_type: selectionType,
          rider_id: selection.rider_id,
          team_id: null,
          predicted_position: null
        }];
      }),
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
    // The generated RPC type does not represent nullable Postgres parameters;
    // overall-jersey tips intentionally pass null at runtime.
    p_stage_id: input.stageId!,
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

/**
 * All of the current user's own "daily"/"stage" tips for a competition, one
 * row per stage the user has tipped (draft or otherwise) - regardless of
 * lock/scored status, since RLS already lets an owner read their own tips
 * unconditionally ("user_id = auth.uid()"). Used for the "My Tips"/history
 * screen; the caller correlates each row's stage_id against the already-
 * fetched stage list to get stage_number/date/type, and computes cumulative
 * totals client-side (see apps/mobile/lib/grandtourHistoryExperience.ts) -
 * no join multiplication risk since hydrateTips already resolves
 * selections/scores via separate single-table `.in()` queries, and this
 * function returns at most one row per stage.
 */
export async function listMyGrandTourStageTips(competitionId: string): Promise<GrandTourTipRecord[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await getSupabaseClient()
    .from("grandtour_tips")
    .select(tipColumns)
    .eq("user_id", user.id)
    .eq("competition_id", competitionId)
    .eq("tip_mode", "daily")
    .eq("tip_scope", "stage");
  if (error) throw error;
  return hydrateTips(data ?? []);
}

export async function listCyclingLeaderboard(
  competitionId: string,
  leaderboardType: CyclingLeaderboardRow["leaderboard_type"] = "overall"
): Promise<CyclingLeaderboardRow[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("get_grandtour_leaderboard_with_movement", {
    p_competition_id: competitionId,
    p_leaderboard_type: leaderboardType
  });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    leaderboard_type: row.leaderboard_type as CyclingLeaderboardRow["leaderboard_type"]
  }));
}
