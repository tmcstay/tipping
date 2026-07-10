import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";

import { AppShell } from "../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import { StageResultCard } from "../components/StageResultCard";
import { ui } from "../components/theme";
import { useCyclingStageResults, useTdf2026Stages } from "../hooks/useCyclingData";

export default function ResultsScreen() {
  const router = useRouter();
  const { race, stages } = useTdf2026Stages();
  const results = useCyclingStageResults(race.data?.id);
  const loading = race.loading || stages.loading || results.loading;
  const ordered = [...(results.data ?? [])].sort((a, b) => {
    const aStage = stages.data?.find((stage) => stage.id === a.stage_id)?.stage_number ?? 0;
    const bStage = stages.data?.find((stage) => stage.id === b.stage_id)?.stage_number ?? 0;
    return bStage - aStage;
  });

  return (
    <AppShell title="Stage results" subtitle="Official stage placings, jersey holders, and your scoring context.">
      <Pressable accessibilityRole="button" onPress={() => router.push("/my-tips")} style={myTipsLinkStyles.link}>
        <Text style={myTipsLinkStyles.linkText}>View My Tips & score history →</Text>
      </Pressable>
      {loading ? <LoadingState /> : null}
      {race.error ? <ErrorState error={race.error} onRetry={race.reload} /> : null}
      {stages.error ? <ErrorState error={stages.error} onRetry={stages.reload} /> : null}
      {results.error ? <ErrorState error={results.error} onRetry={results.reload} /> : null}
      {!loading && !race.error && !stages.error && !results.error && ordered.length === 0 ? (
        <EmptyState message="No official stage results are available yet." />
      ) : null}
      {ordered.map((result) => {
        const stage = stages.data?.find((candidate) => candidate.id === result.stage_id);
        return stage ? (
          <StageResultCard key={result.id} onOpen={() => router.push(`/stages/${stage.id}`)} result={result} stage={stage} />
        ) : null;
      })}
    </AppShell>
  );
}

const myTipsLinkStyles = StyleSheet.create({
  link: {
    alignItems: "center",
    backgroundColor: ui.colors.primarySoft,
    borderRadius: ui.radius.medium,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 14
  },
  linkText: {
    color: ui.colors.primary,
    fontSize: 14,
    fontWeight: "800"
  }
});
