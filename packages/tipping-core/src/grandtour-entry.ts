import type { GrandTourTipSelectionInput } from "@tipping-suite/shared-types";

export const DAILY_JERSEY_SELECTIONS = [
  "yellow_holder",
  "green_holder",
  "kom_holder",
  "white_holder"
] as const;

export const OVERALL_JERSEY_SELECTIONS = [
  "overall_yellow_winner",
  "overall_green_winner",
  "overall_kom_winner",
  "overall_white_winner"
] as const;

export function isTeamTimeTrialStageType(stageType: string | null | undefined): boolean {
  return stageType === "team_time_trial" || stageType === "ttt";
}

export function buildStageTipSelections(
  topFive: (string | null)[],
  jerseys: Partial<Record<(typeof DAILY_JERSEY_SELECTIONS)[number], string>> = {}
): GrandTourTipSelectionInput[] {
  const selectedTopFive = topFive.filter((riderId): riderId is string => Boolean(riderId));
  if (new Set(selectedTopFive).size !== selectedTopFive.length) {
    throw new Error("The Top 5 must contain five different riders.");
  }
  return [
    ...topFive.flatMap((riderId, index) => riderId ? [{
      selection_type: "stage_top_5" as const,
      rider_id: riderId,
      predicted_position: index + 1
    }] : []),
    ...DAILY_JERSEY_SELECTIONS.flatMap((selectionType) => jerseys[selectionType] ? [{
      selection_type: selectionType,
      rider_id: jerseys[selectionType] as string,
      predicted_position: null
    }] : [])
  ];
}

export function buildTeamTimeTrialTipSelections(
  topFive: (string | null)[],
  jerseys: Partial<Record<(typeof DAILY_JERSEY_SELECTIONS)[number], string>> = {}
): GrandTourTipSelectionInput[] {
  const selectedTopFive = topFive.filter((teamId): teamId is string => Boolean(teamId));
  if (new Set(selectedTopFive).size !== selectedTopFive.length) {
    throw new Error("The TTT Top 5 must contain five different teams.");
  }
  return [
    ...topFive.flatMap((teamId, index) => teamId ? [{
      selection_type: "stage_top_5" as const,
      team_id: teamId,
      predicted_position: index + 1
    }] : []),
    ...DAILY_JERSEY_SELECTIONS.flatMap((selectionType) => jerseys[selectionType] ? [{
      selection_type: selectionType,
      rider_id: jerseys[selectionType] as string,
      predicted_position: null
    }] : [])
  ];
}

export function buildOverallJerseySelections(
  jerseys: Partial<Record<(typeof OVERALL_JERSEY_SELECTIONS)[number], string>>
): GrandTourTipSelectionInput[] {
  return OVERALL_JERSEY_SELECTIONS.flatMap((selectionType) => jerseys[selectionType] ? [{
    selection_type: selectionType,
    rider_id: jerseys[selectionType] as string,
    predicted_position: null
  }] : []);
}

export function isCompleteStageTip(selections: GrandTourTipSelectionInput[]) {
  const topFive = selections.filter((selection) => selection.selection_type === "stage_top_5");
  const nonTopFiveValid = selections
    .filter((selection) => selection.selection_type !== "stage_top_5")
    .every((selection) => Boolean(selection.rider_id) && !selection.team_id);
  return topFive.length === 5
    && topFive.every((selection) => Boolean(selection.rider_id) && !selection.team_id)
    && new Set(topFive.map((selection) => selection.rider_id)).size === 5
    && nonTopFiveValid;
}

export function isCompleteTeamTimeTrialTip(selections: GrandTourTipSelectionInput[]) {
  const topFive = selections.filter((selection) => selection.selection_type === "stage_top_5");
  const nonTopFiveValid = selections
    .filter((selection) => selection.selection_type !== "stage_top_5")
    .every((selection) => Boolean(selection.rider_id) && !selection.team_id);
  return topFive.length === 5
    && topFive.every((selection) => Boolean(selection.team_id) && !selection.rider_id)
    && new Set(topFive.map((selection) => selection.team_id)).size === 5
    && nonTopFiveValid;
}

export function isCompleteOverallJerseyTip(selections: GrandTourTipSelectionInput[]) {
  return OVERALL_JERSEY_SELECTIONS.every((type) =>
    selections.some((selection) => selection.selection_type === type)
  );
}
