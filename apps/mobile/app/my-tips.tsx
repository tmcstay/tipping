import { useMemo } from "react";

import { AppShell } from "../components/AppShell";
import { CumulativeTotalsCard } from "../components/CumulativeTotalsCard";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import { MyTipsStageCard } from "../components/MyTipsStageCard";
import {
  useCyclingCompetition,
  useCyclingStageResults,
  useTdf2026Stages,
  useTdfRiders,
  useTdfTeams
} from "../hooks/useCyclingData";
import { useMyGrandTourStageTips } from "../hooks/useGrandTourTips";
import { computeCumulativeHistory, computeHistorySummary, type HistoryStageScoreRow } from "../lib/grandtourHistoryExperience";
import { formatRiderDisplayName } from "../lib/formatters";
import { getStageTipExperience } from "../lib/stageExperience";

export default function MyTipsScreen() {
  const { race, stages } = useTdf2026Stages();
  const competition = useCyclingCompetition(race.data?.id);
  const { riders } = useTdfRiders();
  const { teams } = useTdfTeams();
  const myTips = useMyGrandTourStageTips(competition.data?.id);
  const results = useCyclingStageResults(race.data?.id);

  const itemName = useMemo(() => {
    const riderNames = new Map((riders.data ?? []).map((rider) => [
      rider.id,
      formatRiderDisplayName(rider.display_name, rider.bib_number)
    ]));
    const teamNames = new Map((teams.data ?? []).map((team) => [team.id, team.name]));
    return (id: string) => riderNames.get(id) ?? teamNames.get(id) ?? "Unknown";
  }, [riders.data, teams.data]);

  const stageRows = useMemo(() => (stages.data ?? [])
    .slice()
    .sort((a, b) => a.stage_number - b.stage_number)
    .map((stage) => {
      const tip = (myTips.data ?? []).find((candidate) => candidate.stage_id === stage.id) ?? null;
      const officialResult = (results.data ?? []).find((candidate) => candidate.stage_id === stage.id) ?? null;
      return { stage, tip, officialResult, isTtt: getStageTipExperience(stage.stage_type).isTtt };
    }), [stages.data, myTips.data, results.data]);

  const historyRows: HistoryStageScoreRow[] = useMemo(() => stageRows.map(({ stage, tip }) => ({
    stageId: stage.id,
    stageNumber: stage.stage_number,
    totalScore: tip?.status === "scored" ? tip.total_score : null,
    top5Score: tip?.score?.top5_score ?? null,
    jerseyScore: tip?.score?.jersey_score ?? null,
    bonusScore: tip?.score?.bonus_score ?? null
  })), [stageRows]);

  const cumulativeHistory = useMemo(() => computeCumulativeHistory(historyRows), [historyRows]);
  const summary = useMemo(() => computeHistorySummary(historyRows), [historyRows]);

  const loading = race.loading || stages.loading || competition.loading || myTips.loading || results.loading || riders.loading || teams.loading;

  return (
    <AppShell subtitle="Your picks, score breakdowns, and cumulative total for every stage." title="My Tips">
      {loading ? <LoadingState /> : null}
      {race.error ? <ErrorState error={race.error} onRetry={race.reload} /> : null}
      {stages.error ? <ErrorState error={stages.error} onRetry={stages.reload} /> : null}
      {competition.error ? <ErrorState error={competition.error} onRetry={competition.reload} /> : null}
      {myTips.error ? <ErrorState error={myTips.error} onRetry={myTips.reload} /> : null}
      {results.error ? <ErrorState error={results.error} onRetry={results.reload} /> : null}

      {!loading && stageRows.length > 0 ? <CumulativeTotalsCard summary={summary} /> : null}

      {!loading && stageRows.length === 0 ? (
        <EmptyState message="No stages are available yet." />
      ) : null}

      {!loading && stageRows.map(({ isTtt, officialResult, stage, tip }) => {
        const cumulative = cumulativeHistory.find((row) => row.stageId === stage.id);
        return (
          <MyTipsStageCard
            cumulativeTotal={cumulative?.cumulativeTotal ?? 0}
            isTtt={isTtt}
            itemName={itemName}
            key={stage.id}
            officialResult={officialResult}
            stageDate={stage.starts_at}
            stageNumber={stage.stage_number}
            tip={tip}
          />
        );
      })}
    </AppShell>
  );
}
