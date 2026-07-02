import { useCallback } from "react";
import {
  getCyclingRaceByYear,
  getPublicCyclingCompetition,
  listCyclingCompetitions,
  listCyclingLeaderboard,
  listCyclingRiders,
  listCyclingStages,
  listCyclingTeams,
  listStageStartlist,
  type CyclingLeaderboardRow
} from "@tipping-suite/supabase-client";

import { useAsyncData } from "./useAsyncData";

export function useCyclingRace(year = 2026) {
  const loadRace = useCallback(() => getCyclingRaceByYear(year), [year]);
  return useAsyncData(loadRace, [year]);
}

export function useTdf2026Race() {
  return useCyclingRace(2026);
}

export function useTdf2026Stages() {
  const race = useTdf2026Race();
  const raceId = race.data?.id ?? null;
  const loadStages = useCallback(
    () => (raceId ? listCyclingStages(raceId) : Promise.resolve([])),
    [raceId]
  );
  const stages = useAsyncData(loadStages, [raceId]);
  return { race, stages };
}

export function useTdfTeams() {
  const race = useTdf2026Race();
  const raceId = race.data?.id ?? null;
  const loadTeams = useCallback(
    () => (raceId ? listCyclingTeams(raceId) : Promise.resolve([])),
    [raceId]
  );
  const teams = useAsyncData(loadTeams, [raceId]);
  return { race, teams };
}

export function useTdfRiders() {
  const race = useTdf2026Race();
  const raceId = race.data?.id ?? null;
  const loadRiders = useCallback(
    () => (raceId ? listCyclingRiders(raceId) : Promise.resolve([])),
    [raceId]
  );
  const riders = useAsyncData(loadRiders, [raceId]);
  return { race, riders };
}

export function useStageStartlist(stageId: string | null | undefined) {
  const loadStartlist = useCallback(
    () => (stageId ? listStageStartlist(stageId) : Promise.resolve([])),
    [stageId]
  );
  return useAsyncData(loadStartlist, [stageId]);
}

export function useCyclingCompetition(raceId: string | null | undefined) {
  const loadCompetition = useCallback(
    () => raceId ? getPublicCyclingCompetition(raceId) : Promise.resolve(null),
    [raceId]
  );
  return useAsyncData(loadCompetition, [raceId]);
}

export function useCyclingCompetitions(raceId: string | null | undefined) {
  const loadCompetitions = useCallback(
    () => raceId ? listCyclingCompetitions(raceId) : Promise.resolve([]),
    [raceId]
  );
  return useAsyncData(loadCompetitions, [raceId]);
}

export function useCyclingLeaderboard(
  competitionId: string | null | undefined,
  leaderboardType: CyclingLeaderboardRow["leaderboard_type"] = "overall"
) {
  const loadLeaderboard = useCallback(
    () => competitionId
      ? listCyclingLeaderboard(competitionId, leaderboardType)
      : Promise.resolve([]),
    [competitionId, leaderboardType]
  );
  return useAsyncData(loadLeaderboard, [competitionId, leaderboardType]);
}
