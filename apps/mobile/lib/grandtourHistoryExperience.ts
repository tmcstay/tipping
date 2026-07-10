export type HistoryStageScoreRow = {
  stageId: string;
  stageNumber: number;
  totalScore: number | null;
  top5Score: number | null;
  jerseyScore: number | null;
  bonusScore: number | null;
};

export type HistoryStageRowWithCumulative = HistoryStageScoreRow & {
  cumulativeTotal: number;
};

/**
 * Sorts stage rows by stage number and adds a running cumulative total -
 * the sum of every scored stage's total_score up to and including this
 * row. An unscored stage carries forward the previous cumulative total
 * unchanged (its own totalScore stays null, distinguishing "not yet
 * scored" from "scored zero").
 */
export function computeCumulativeHistory(rows: HistoryStageScoreRow[]): HistoryStageRowWithCumulative[] {
  const sorted = [...rows].sort((a, b) => a.stageNumber - b.stageNumber);
  let running = 0;
  return sorted.map((row) => {
    if (row.totalScore !== null) running += row.totalScore;
    return { ...row, cumulativeTotal: running };
  });
}

export type GrandTourHistorySummary = {
  totalScore: number;
  totalTop5: number;
  totalJersey: number;
  totalBonus: number;
  scoredStages: number;
  bestStageScore: number | null;
  averageScore: number | null;
};

/**
 * Cumulative totals across every scored stage. Unscored stages (totalScore
 * === null) are excluded from every sum/average/best-score calculation, so
 * a stage that simply hasn't been scored yet never drags the average down
 * or is mistaken for a real zero score.
 */
export function computeHistorySummary(rows: HistoryStageScoreRow[]): GrandTourHistorySummary {
  const scored = rows.filter((row) => row.totalScore !== null);
  const totalScore = scored.reduce((sum, row) => sum + (row.totalScore ?? 0), 0);
  const totalTop5 = scored.reduce((sum, row) => sum + (row.top5Score ?? 0), 0);
  const totalJersey = scored.reduce((sum, row) => sum + (row.jerseyScore ?? 0), 0);
  const totalBonus = scored.reduce((sum, row) => sum + (row.bonusScore ?? 0), 0);
  const bestStageScore = scored.length > 0
    ? Math.max(...scored.map((row) => row.totalScore ?? 0))
    : null;
  const averageScore = scored.length > 0 ? totalScore / scored.length : null;

  return {
    totalScore,
    totalTop5,
    totalJersey,
    totalBonus,
    scoredStages: scored.length,
    bestStageScore,
    averageScore
  };
}

export type TopFiveMatchType = "exact" | "top5-wrong-position" | "outside-top-5" | "not-picked";

export type TopFiveComparisonRow = {
  predictedPosition: number;
  predictedRiderId: string | null;
  actualPosition: number | null;
  matchType: TopFiveMatchType;
};

/**
 * Classifies each of the user's 5 predicted positions against the actual
 * top-10 result. "top5-wrong-position" mirrors the real scoring rule
 * (1 point for a top-5 rider predicted in the wrong position); a rider who
 * finished 6th-10th is "outside-top-5" (never scores top5 points, but is
 * worth showing so the comparison isn't misleadingly blank), and a rider
 * absent from the returned actual results entirely is also
 * "outside-top-5" as far as this view is concerned.
 */
export function compareTopFiveWithResult(
  predicted: { position: number; riderId: string | null }[],
  actual: { position: number; riderId: string }[]
): TopFiveComparisonRow[] {
  const actualByRider = new Map(actual.map((row) => [row.riderId, row.position]));

  return predicted
    .filter((entry) => entry.position >= 1 && entry.position <= 5)
    .sort((a, b) => a.position - b.position)
    .map((entry) => {
      if (!entry.riderId) {
        return { predictedPosition: entry.position, predictedRiderId: null, actualPosition: null, matchType: "not-picked" as const };
      }
      const actualPosition = actualByRider.get(entry.riderId) ?? null;
      let matchType: TopFiveMatchType;
      if (actualPosition === entry.position) matchType = "exact";
      else if (actualPosition !== null && actualPosition <= 5) matchType = "top5-wrong-position";
      else matchType = "outside-top-5";
      return { predictedPosition: entry.position, predictedRiderId: entry.riderId, actualPosition, matchType };
    });
}

export type JerseyMatchType = "match" | "miss" | "not-picked" | "pending";
export type JerseyType = "yellow" | "green" | "kom" | "white";

export type JerseyComparisonRow = {
  jerseyType: JerseyType;
  predictedRiderId: string | null;
  actualRiderId: string | null;
  matchType: JerseyMatchType;
};

const JERSEY_TYPES: JerseyType[] = ["yellow", "green", "kom", "white"];

/**
 * Classifies each of the 4 jersey picks against the actual holders.
 * "pending" means the official jersey result for that type isn't
 * available yet (actual holder not found) - distinct from "miss", which
 * means the actual holder is known and it wasn't the predicted rider.
 */
export function compareJerseyPicks(
  predicted: { jerseyType: JerseyType; riderId: string | null }[],
  actual: { jerseyType: JerseyType; riderId: string }[]
): JerseyComparisonRow[] {
  const predictedByType = new Map(predicted.map((entry) => [entry.jerseyType, entry.riderId]));
  const actualByType = new Map(actual.map((entry) => [entry.jerseyType, entry.riderId]));

  return JERSEY_TYPES.map((jerseyType) => {
    const predictedRiderId = predictedByType.get(jerseyType) ?? null;
    const actualRiderId = actualByType.get(jerseyType) ?? null;
    let matchType: JerseyMatchType;
    if (!predictedRiderId) matchType = "not-picked";
    else if (!actualRiderId) matchType = "pending";
    else matchType = predictedRiderId === actualRiderId ? "match" : "miss";
    return { jerseyType, predictedRiderId, actualRiderId, matchType };
  });
}
