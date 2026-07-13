import { isStageEligibleForResults } from "@tipping-suite/tipping-core";
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
  const now = new Date();
  // Defensive final-layer check (packages/supabase-client's query already
  // filters is_final/starts_at at the earliest layer) - a stage row is
  // never shown as a result here unless it's genuinely eligible, sorted
  // deterministically by actual start time (never insertion order).
  const ordered = [...(results.data ?? [])]
    .map((result) => ({ result, stage: stages.data?.find((stage) => stage.id === result.stage_id) ?? null }))
    .filter((entry): entry is { result: typeof entry.result; stage: NonNullable<typeof entry.stage> } =>
      Boolean(entry.stage) && isStageEligibleForResults({ startsAt: entry.stage!.starts_at, isFinal: true }, now)
    )
    .sort((a, b) => new Date(b.stage.starts_at).getTime() - new Date(a.stage.starts_at).getTime())
    .map((entry) => entry.result);

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
