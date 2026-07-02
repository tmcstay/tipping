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

export function buildStageTipSelections(
  topFive: (string | null)[],
  jerseys: Partial<Record<(typeof DAILY_JERSEY_SELECTIONS)[number], string>>
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
  const jerseys = DAILY_JERSEY_SELECTIONS.filter((type) =>
    selections.some((selection) => selection.selection_type === type)
  );
  return topFive.length === 5
    && new Set(topFive.map((selection) => selection.rider_id)).size === 5
    && jerseys.length === DAILY_JERSEY_SELECTIONS.length;
}

export function isCompleteOverallJerseyTip(selections: GrandTourTipSelectionInput[]) {
  return OVERALL_JERSEY_SELECTIONS.every((type) =>
    selections.some((selection) => selection.selection_type === type)
  );
}
