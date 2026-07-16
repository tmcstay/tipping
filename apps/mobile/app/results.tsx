import { isStageEligibleForResults } from "@tipping-suite/tipping-core";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";

import { AppShell } from "../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import { StageResultCard } from "../components/StageResultCard";
import { ui } from "../components/theme";
import { useCyclingCompetition, useCyclingStageResults, useTdf2026Stages } from "../hooks/useCyclingData";
import { useMyGrandTourStageTips } from "../hooks/useGrandTourTips";
import { formatGrandTourName } from "../lib/grandTourDisplay";
import { buildStageResultBadgesForTip } from "../lib/grandtourStageResultsExperience";
import { getStageTipExperience } from "../lib/stageExperience";

export default function ResultsScreen() {
  const router = useRouter();
  const { race, stages } = useTdf2026Stages();
  const competition = useCyclingCompetition(race.data?.id);
  const results = useCyclingStageResults(race.data?.id);
  const myTips = useMyGrandTourStageTips(competition.data?.id);
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
    <AppShell
      raceName={formatGrandTourName(race.data)}
      title="Stage results"
      subtitle="Official stage placings, jersey holders, and your scoring context."
    >
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
        if (!stage) return null;

        // Per-row scoring badges: how the signed-in user's tip fared
        // against each official Top 5 row (green exact / blue partial /
        // neutral no-pick). Tip data failing to load just omits badges -
        // never blocks the official result itself from rendering.
        const isTtt = getStageTipExperience(stage.stage_type).isTtt;
        const tip = myTips.data?.find((candidate) => candidate.stage_id === stage.id) ?? null;
        const scoreBadges = buildStageResultBadgesForTip({ result, isTtt, tip });

        return (
          <StageResultCard
            key={result.id}
            onOpen={() => router.push(`/stages/${stage.id}`)}
            result={result}
            scoreBadges={scoreBadges}
            stage={stage}
          />
        );
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
