import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import type { GrandTourTipMode } from "@tipping-suite/shared-types";

import { AppShell } from "../../../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../../components/DataState";
import { TipComparisonCard } from "../../../components/TipComparisonCard";
import { useCyclingCompetition, useStageStartlist, useTdf2026Stages } from "../../../hooks/useCyclingData";
import { useLeagueTipsAfterLock } from "../../../hooks/useGrandTourTips";

export default function StageComparisonScreen() {
  const params = useLocalSearchParams<{ stageId: string; mode?: string }>();
  const stageId = Array.isArray(params.stageId) ? params.stageId[0] : params.stageId;
  const tipMode: GrandTourTipMode = params.mode === "preselection" ? "preselection" : "daily";
  const { race, stages } = useTdf2026Stages();
  const competition = useCyclingCompetition(race.data?.id);
  const startlist = useStageStartlist(stageId);
  const tips = useLeagueTipsAfterLock({ competitionId: competition.data?.id, stageId, tipMode, tipScope: "stage" });
  const names = useMemo(() => new Map((startlist.data ?? []).map((entry) => [entry.rider.id, entry.rider.display_name])), [startlist.data]);
  const stage = stages.data?.find((candidate) => candidate.id === stageId);

  return (
    <AppShell title={`Stage ${stage?.stage_number ?? ""} comparison`} subtitle={`${tipMode} · submitted tips only`}>
      {tips.loading || startlist.loading ? <LoadingState /> : null}
      {tips.error ? <ErrorState error={tips.error} onRetry={tips.reload} /> : null}
      {startlist.error ? <ErrorState error={startlist.error} onRetry={startlist.reload} /> : null}
      {!tips.loading && !tips.error && tips.data?.length === 0 ? (
        <EmptyState message="No eligible submitted tips have been released by the server. Drafts always remain private." />
      ) : null}
      {tips.data?.map((tip) => <TipComparisonCard key={tip.id} tip={tip} riderName={(id) => names.get(id) ?? "Unknown rider"} />)}
    </AppShell>
  );
}
