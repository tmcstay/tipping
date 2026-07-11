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

