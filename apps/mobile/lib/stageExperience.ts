export const TTT_STAGE_TIP_COPY =
  "Pick your top 5 teams for the stage result.";

export const ROAD_STAGE_TIP_COPY =
  "Pick your top 5 riders for the stage result.";

export const TTT_RESULT_COPY =
  "TTT stage points are scored against the official team result. Jersey points are scored against the official individual jersey holders after the stage.";

export const TTT_RESULT_SECTIONS = [
  "Team Time Trial Result",
  "Jersey Results"
] as const;

export type StageTipExperience = {
  isTtt: boolean;
  topFivePicker: "rider" | "team";
  topFiveTitle: string;
  topFiveCopy: string;
  reviewTitle: string;
};

export function getStageTipExperience(stageType: string | null | undefined): StageTipExperience {
  const isTtt = stageType === "team_time_trial" || stageType === "ttt";
  return {
    isTtt,
    topFivePicker: isTtt ? "team" : "rider",
    topFiveTitle: isTtt ? "Team Time Trial Top 5" : "Ordered Top 5",
    topFiveCopy: isTtt ? TTT_STAGE_TIP_COPY : ROAD_STAGE_TIP_COPY,
    reviewTitle: isTtt ? "Team Time Trial Picks" : "Stage Result Picks"
  };
}
