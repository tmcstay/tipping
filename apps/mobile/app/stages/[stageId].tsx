import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { isCyclingStageTipLocked } from "@tipping-suite/tipping-core";

import { AppShell } from "../../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/DataState";
import { InfoCard } from "../../components/InfoCard";
import {
  useCurrentCyclingTip,
  useCyclingCompetition,
  useStageStartlist,
  useSubmitCyclingTip,
  useTdf2026Stages
} from "../../hooks/useCyclingData";
import { formatDateTime } from "../../lib/formatters";

export default function StageDetailScreen() {
  const params = useLocalSearchParams<{ stageId: string }>();
  const stageId = Array.isArray(params.stageId) ? params.stageId[0] : params.stageId;
  const { race, stages } = useTdf2026Stages();
  const stage = stages.data?.find((candidate) => candidate.id === stageId) ?? null;
  const competition = useCyclingCompetition(race.data?.id);
  const startlist = useStageStartlist(stageId);
  const currentTip = useCurrentCyclingTip({
    competitionId: competition.data?.id,
    stageId
  });
  const submitState = useSubmitCyclingTip();
  const [search, setSearch] = useState("");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const locked = stage ? isCyclingStageTipLocked({ startTime: stage.locks_at }) : true;
  const filteredRiders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (startlist.data ?? [])
      .filter((entry) => !query || entry.rider.display_name.toLocaleLowerCase().includes(query) || entry.team?.name.toLocaleLowerCase().includes(query))
      .sort((left, right) => left.rider.display_name.localeCompare(right.rider.display_name));
  }, [search, startlist.data]);

  const selectRider = async (riderId: string, riderName: string) => {
    if (!competition.data || !stageId || locked) return;
    setSaveMessage(null);
    try {
      await submitState.submit({
        competitionId: competition.data.id,
        riderId,
        stageId
      });
      setSaveMessage(`${riderName} saved as your stage-winner pick.`);
      currentTip.reload();
    } catch {
      // The hook exposes the user-facing error below.
    }
  };

  return (
    <AppShell
      title={stage ? `Stage ${stage.stage_number}` : "Stage detail"}
      subtitle={stage ? `${stage.start_location ?? "TBC"} → ${stage.finish_location ?? "TBC"}` : undefined}
    >
      {stages.loading ? <LoadingState /> : null}
      {stages.error ? <ErrorState error={stages.error} onRetry={stages.reload} /> : null}
      {!stages.loading && !stages.error && !stage ? (
        <EmptyState message="This stage could not be found." />
      ) : null}

      {stage ? (
        <InfoCard title={stage.stage_name ?? `Stage ${stage.stage_number}`} meta={stage.stage_type.replaceAll("_", " ")}>
          <Text style={styles.copy}>Starts {formatDateTime(stage.starts_at)}</Text>
          <Text style={styles.copy}>{stage.distance_km ?? "—"} km</Text>
          <Text style={locked ? styles.locked : styles.lock}>
            {locked ? "Tipping is locked" : `Tips lock ${formatDateTime(stage.locks_at)}`}
          </Text>
          {stage.start_time_is_estimated ? (
            <Text style={styles.provisional}>Start and lock times are provisional.</Text>
          ) : null}
        </InfoCard>
      ) : null}

      <InfoCard title="Pick the stage winner" meta="Daily tip">
        <Text style={styles.copy}>
          Choose one rider. Provisional and confirmed startlist riders are selectable.
        </Text>
        <Text style={styles.provisional}>
          MVP picks are stored as drafts while the complete submission flow is finished.
        </Text>
        <Text style={styles.selected}>
          Current pick: {startlist.data?.find((entry) => entry.rider.id === currentTip.data?.riderId)?.rider.display_name ?? "None"}
        </Text>
        {saveMessage ? <Text style={styles.success}>{saveMessage}</Text> : null}
        {submitState.error ? <Text style={styles.locked}>{submitState.error}</Text> : null}
        <TextInput
          accessibilityLabel="Search riders"
          onChangeText={setSearch}
          placeholder="Search riders or teams"
          style={styles.search}
          value={search}
        />
      </InfoCard>

      {startlist.loading ? <LoadingState /> : null}
      {startlist.error ? <ErrorState error={startlist.error} onRetry={startlist.reload} /> : null}
      {!startlist.loading && !startlist.error && filteredRiders.length === 0 ? (
        <EmptyState message="No selectable riders match this search." />
      ) : null}
      <View style={styles.riderList}>
        {!startlist.loading && !startlist.error && filteredRiders.map((entry) => {
          const selected = currentTip.data?.riderId === entry.rider.id;
          return (
            <Pressable
              disabled={locked || submitState.saving || !competition.data}
              key={entry.id}
              onPress={() => selectRider(entry.rider.id, entry.rider.display_name)}
              style={[
                styles.riderButton,
                selected && styles.riderButtonSelected,
                (locked || submitState.saving || !competition.data) && styles.disabled
              ]}
            >
              <View style={styles.riderText}>
                <Text style={[styles.riderName, selected && styles.selectedText]}>{entry.rider.display_name}</Text>
                <Text style={[styles.teamName, selected && styles.selectedText]}>
                  {entry.team?.name ?? "Team TBC"} · {entry.rider.nationality ?? "Nationality TBC"}
                </Text>
              </View>
              <Text style={[styles.status, selected && styles.selectedText]}>
                {selected ? "Selected" : entry.status}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  copy: { color: "#536159", fontSize: 15, lineHeight: 21 },
  disabled: { opacity: 0.5 },
  lock: { color: "#12372A", fontSize: 14, fontWeight: "800" },
  locked: { color: "#A12622", fontSize: 14, fontWeight: "800" },
  provisional: { color: "#8A5A00", fontSize: 12, fontWeight: "700" },
  riderButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#D8DED9",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 66,
    padding: 12
  },
  riderButtonSelected: { backgroundColor: "#12372A", borderColor: "#12372A" },
  riderList: { gap: 8 },
  riderName: { color: "#17231C", fontSize: 15, fontWeight: "800" },
  riderText: { flex: 1, paddingRight: 8 },
  search: {
    borderColor: "#C9D1CB",
    borderRadius: 8,
    borderWidth: 1,
    color: "#17231C",
    marginTop: 8,
    minHeight: 46,
    paddingHorizontal: 12
  },
  selected: { color: "#12372A", fontSize: 14, fontWeight: "800" },
  selectedText: { color: "#FFFFFF" },
  status: { color: "#6A746D", fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  success: { color: "#176B3A", fontSize: 14, fontWeight: "800" },
  teamName: { color: "#68746D", fontSize: 12, marginTop: 3 }
});
