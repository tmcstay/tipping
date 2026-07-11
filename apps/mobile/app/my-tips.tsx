import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppShell } from "../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import { GrandTourResultsSummary } from "../components/GrandTourResultsSummary";
import { GrandTourStageResultAccordion } from "../components/GrandTourStageResultAccordion";
import { ui } from "../components/theme";
import {
  useCyclingCompetition,
  useCyclingStageResults,
  useTdf2026Stages,
  useTdfRiders,
  useTdfTeams
} from "../hooks/useCyclingData";
import { useMyGrandTourStageTips } from "../hooks/useGrandTourTips";
import { computeHistorySummary, type HistoryStageScoreRow } from "../lib/grandtourHistoryExperience";
import { sortStageRows, STAGE_SORT_OPTIONS, type StageSortMode } from "../lib/grandtourStageResultsExperience";
import { getStageTipExperience } from "../lib/stageExperience";

export default function MyTipsScreen() {
  const { race, stages } = useTdf2026Stages();
  const competition = useCyclingCompetition(race.data?.id);
  const { riders } = useTdfRiders();
  const { teams } = useTdfTeams();
  const myTips = useMyGrandTourStageTips(competition.data?.id);
  const results = useCyclingStageResults(race.data?.id);
  const [sortMode, setSortMode] = useState<StageSortMode>("newest");

  const riderLookup = useMemo(() => {
    const teamNameById = new Map((teams.data ?? []).map((team) => [team.id, team.name]));
    const byId = new Map((riders.data ?? []).map((rider) => [
      rider.id,
      { name: rider.display_name, bibNumber: rider.bib_number, teamName: rider.team_id ? teamNameById.get(rider.team_id) ?? null : null }
    ]));
    return (id: string) => byId.get(id) ?? null;
  }, [riders.data, teams.data]);

  const stageRows = useMemo(() => (stages.data ?? [])
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

  const summary = useMemo(() => computeHistorySummary(historyRows), [historyRows]);

  const sortableRows = useMemo(() => stageRows.map((row) => ({
    ...row,
    stageNumber: row.stage.stage_number,
    totalScore: row.tip?.status === "scored" ? row.tip.total_score : null
  })), [stageRows]);
  const sortedRows = useMemo(() => sortStageRows(sortableRows, sortMode), [sortableRows, sortMode]);

  const loading = race.loading || stages.loading || competition.loading || myTips.loading || results.loading || riders.loading || teams.loading;

  return (
    <AppShell subtitle="Your picks, official results, and score breakdown for every stage." title="My Tips">
      {loading ? <LoadingState /> : null}
      {race.error ? <ErrorState error={race.error} onRetry={race.reload} /> : null}
      {stages.error ? <ErrorState error={stages.error} onRetry={stages.reload} /> : null}
      {competition.error ? <ErrorState error={competition.error} onRetry={competition.reload} /> : null}
      {myTips.error ? <ErrorState error={myTips.error} onRetry={myTips.reload} /> : null}
      {results.error ? <ErrorState error={results.error} onRetry={results.reload} /> : null}

      {!loading && stageRows.length > 0 ? <GrandTourResultsSummary summary={summary} /> : null}

      {!loading && stageRows.length === 0 ? (
        <EmptyState message="No stages are available yet." />
      ) : null}

      {!loading && stageRows.length > 0 ? (
        <View style={styles.sortRow}>
          {STAGE_SORT_OPTIONS.map((option) => (
            <Pressable
              accessibilityLabel={`Sort by ${option.label}`}
              accessibilityRole="button"
              key={option.key}
              onPress={() => setSortMode(option.key)}
              style={[styles.sortPill, sortMode === option.key && styles.sortPillActive]}
            >
              <Text style={[styles.sortPillText, sortMode === option.key && styles.sortPillTextActive]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {!loading && sortedRows.map(({ isTtt, officialResult, stage, tip }) => (
        <GrandTourStageResultAccordion
          isTtt={isTtt}
          key={stage.id}
          officialResult={officialResult}
          riderLookup={riderLookup}
          stageDate={stage.starts_at}
          stageName={stage.stage_name}
          stageNumber={stage.stage_number}
          stageType={stage.stage_type}
          tip={tip}
        />
      ))}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  sortPill: { backgroundColor: ui.colors.surface, borderColor: ui.colors.border, borderRadius: ui.radius.pill, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  sortPillActive: { backgroundColor: ui.colors.primary, borderColor: ui.colors.primary },
  sortPillText: { color: ui.colors.muted, fontSize: 12, fontWeight: "900" },
  sortPillTextActive: { color: "#FFFFFF" },
  sortRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
});
