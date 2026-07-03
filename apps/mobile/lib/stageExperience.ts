export const TTT_STAGE_TIP_COPY =
  "Team Time Trial stage: pick the top 5 teams for the stage result. Jersey tips are still individual riders and are scored from the official jersey holders after the stage.";

export const TTT_RESULT_COPY =
  "TTT stage points are scored against the official team result. Jersey points are scored against the official individual jersey holders after the stage.";

export const TTT_RESULT_SECTIONS = [
  "Team Time Trial Result",
  "Jersey Results"
] as const;

export type StageTipExperience = {
  isTtt: boolean;
  topFivePicker: "rider" | "team";
  jerseyPicker: "rider";
  topFiveTitle: string;
  topFiveCopy: string;
};

export function getStageTipExperience(stageType: string | null | undefined): StageTipExperience {
  const isTtt = stageType === "team_time_trial" || stageType === "ttt";
  return {
    isTtt,
    topFivePicker: isTtt ? "team" : "rider",
    jerseyPicker: "rider",
    topFiveTitle: isTtt ? "Team Time Trial Top 5" : "Ordered Top 5",
    topFiveCopy: isTtt
      ? TTT_STAGE_TIP_COPY
      : "Select five different riders in predicted finishing order."
  };
}
