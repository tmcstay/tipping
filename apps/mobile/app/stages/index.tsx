import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";

import { AppShell } from "../../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/DataState";
import { InfoCard } from "../../components/InfoCard";
import { useTdf2026Stages } from "../../hooks/useCyclingData";
import { formatDateTime } from "../../lib/formatters";

function formatStageType(value: string) {
  return value.replaceAll("_", " ");
}

export default function StageListScreen() {
  const router = useRouter();
  const { race, stages } = useTdf2026Stages();
  const loading = race.loading || stages.loading;

  return (
    <AppShell
      title="Tour de France 2026"
      subtitle="Choose a stage, review its provisional startlist, and pick a winner."
    >
      {loading ? <LoadingState /> : null}
      {race.error ? <ErrorState error={race.error} onRetry={race.reload} /> : null}
      {stages.error ? <ErrorState error={stages.error} onRetry={stages.reload} /> : null}
      {!loading && !race.error && !stages.error && stages.data?.length === 0 ? (
        <EmptyState message="No stages are available. Run the 2026 TDF import after applying the Supabase migration." />
      ) : null}
      {!loading && !race.error && !stages.error && stages.data?.map((stage) => (
          <Pressable key={stage.id} onPress={() => router.push(`/stages/${stage.id}`)}>
            <InfoCard
              title={`Stage ${stage.stage_number}: ${stage.start_location ?? "TBC"} → ${stage.finish_location ?? "TBC"}`}
              meta={formatStageType(stage.stage_type)}
            >
              <Text style={styles.copy}>{formatDateTime(stage.starts_at)}</Text>
              <Text style={styles.copy}>
                {stage.distance_km ? `${stage.distance_km} km` : "Distance TBC"}
              </Text>
              <Text style={styles.lock}>Tips lock {formatDateTime(stage.locks_at)}</Text>
              {stage.start_time_is_estimated ? (
                <Text style={styles.provisional}>Start time is provisional</Text>
              ) : null}
            </InfoCard>
          </Pressable>
      ))}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  copy: { color: "#536159", fontSize: 14 },
  lock: { color: "#12372A", fontSize: 14, fontWeight: "800" },
  provisional: { color: "#8A5A00", fontSize: 12, fontWeight: "700" }
});
