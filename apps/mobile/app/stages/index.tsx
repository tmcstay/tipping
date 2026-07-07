import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppShell } from "../../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/DataState";
import { InfoCard } from "../../components/InfoCard";
import { StageTypeBadge } from "../../components/StageTypeBadge";
import { useTdf2026Stages } from "../../hooks/useCyclingData";
import { formatDateTime, formatDurationUntil } from "../../lib/formatters";
import { getStageTipExperience } from "../../lib/stageExperience";

export default function StageListScreen() {
  const router = useRouter();
  const { race, stages } = useTdf2026Stages();
  const loading = race.loading || stages.loading;

  return (
    <AppShell
      title="Stage tips"
      subtitle="Choose a stage, then enter or review your picks."
    >
      {loading ? <LoadingState /> : null}
      {race.error ? <ErrorState error={race.error} onRetry={race.reload} /> : null}
      {stages.error ? <ErrorState error={stages.error} onRetry={stages.reload} /> : null}
      {!loading && !race.error && !stages.error && stages.data?.length === 0 ? (
        <EmptyState message="No active stages are available yet. Check back when the next race schedule is published." />
      ) : null}
      {!loading && !race.error && !stages.error && stages.data?.map((stage) => {
        const locked = new Date(stage.locks_at).getTime() <= Date.now();
        const experience = getStageTipExperience(stage.stage_type);
        return (
          <Pressable key={stage.id} onPress={() => router.push(`/stages/${stage.id}`)}>
            <InfoCard
              title={`Stage ${stage.stage_number}: ${stage.start_location ?? "TBC"} → ${stage.finish_location ?? "TBC"}`}
              meta={locked ? "Locked" : formatDurationUntil(stage.locks_at)}
            >
              <View style={styles.topRow}>
                <StageTypeBadge stageType={stage.stage_type} />
                <Text style={styles.distance}>{stage.distance_km ? `${stage.distance_km} km` : "Distance TBC"}</Text>
              </View>
              <Text style={styles.copy}>{formatDateTime(stage.starts_at)}</Text>
              <Text style={locked ? styles.locked : styles.lock}>Tips lock {formatDateTime(stage.locks_at)}</Text>
              {experience.isTtt ? (
                <Text style={styles.tttNote}>TTT: pick teams for the stage result.</Text>
              ) : null}
              {stage.start_time_is_estimated ? (
                <Text style={styles.provisional}>Start time is provisional</Text>
              ) : null}
            </InfoCard>
          </Pressable>
        );
      })}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  copy: { color: "#536159", fontSize: 14 },
  distance: { color: "#12372A", fontSize: 13, fontWeight: "900" },
  lock: { color: "#12372A", fontSize: 14, fontWeight: "900" },
  locked: { color: "#A12622", fontSize: 14, fontWeight: "900" },
  provisional: { color: "#8A5A00", fontSize: 12, fontWeight: "800" },
  topRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  tttNote: { backgroundColor: "#E8E5FF", borderRadius: 10, color: "#3A2F8F", fontSize: 13, fontWeight: "800", lineHeight: 18, padding: 10 }
});
