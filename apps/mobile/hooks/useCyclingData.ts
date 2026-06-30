import { useCallback, useState } from "react";
import {
  getCurrentUserCyclingStageWinnerTip,
  getCyclingRaceByYear,
  getPublicCyclingCompetition,
  listCyclingLeaderboard,
  listCyclingRiders,
  listCyclingStages,
  listCyclingTeams,
  listStageStartlist,
  saveCurrentUserCyclingStageWinnerTip,
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

export function useCurrentCyclingTip(input: {
  competitionId: string | null | undefined;
  stageId: string | null | undefined;
}) {
  const loadTip = useCallback(
    () => input.competitionId && input.stageId
      ? getCurrentUserCyclingStageWinnerTip({
          competitionId: input.competitionId,
          stageId: input.stageId
        })
      : Promise.resolve(null),
    [input.competitionId, input.stageId]
  );
  return useAsyncData(loadTip, [input.competitionId, input.stageId]);
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

export function useSubmitCyclingTip() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (input: {
    competitionId: string;
    stageId: string;
    riderId: string;
  }) => {
    setSaving(true);
    setError(null);
    try {
      return await saveCurrentUserCyclingStageWinnerTip(input);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save cycling tip.";
      setError(message);
      throw cause;
    } finally {
      setSaving(false);
    }
  }, []);

  return { error, saving, submit };
}
