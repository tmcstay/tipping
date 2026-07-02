import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { GrandTourTipMode } from "@tipping-suite/shared-types";
import {
  buildStageTipSelections,
  isCompleteStageTip
} from "@tipping-suite/tipping-core";

import { AppShell } from "../../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/DataState";
import { InfoCard } from "../../components/InfoCard";
import { JerseyHolderPicker, type JerseyKey } from "../../components/JerseyHolderPicker";
import { OrderedTopFivePicker } from "../../components/OrderedTopFivePicker";
import { RiderSelectionPanel } from "../../components/RiderSelectionPanel";
import { ScoreBreakdown } from "../../components/ScoreBreakdown";
import { TipStatusBadge, type TipDisplayStatus } from "../../components/TipStatusBadge";
import {
  useCyclingCompetition,
  useStageStartlist,
  useTdf2026Stages
} from "../../hooks/useCyclingData";
import {
  useClearTip,
  useSaveTipDraft,
  useStageTipDraft,
  useSubmitTip
} from "../../hooks/useGrandTourTips";
import { formatDateTime } from "../../lib/formatters";

type ActivePicker = { type: "top5"; position: number } | { type: "jersey"; jersey: JerseyKey } | null;

const jerseySelectionType: Record<JerseyKey, "yellow_holder" | "green_holder" | "kom_holder" | "white_holder"> = {
  yellow: "yellow_holder",
  green: "green_holder",
  kom: "kom_holder",
  white: "white_holder"
};

export default function StageTipScreen() {
  const params = useLocalSearchParams<{ stageId: string }>();
  const router = useRouter();
  const stageId = Array.isArray(params.stageId) ? params.stageId[0] : params.stageId;
  const { race, stages } = useTdf2026Stages();
  const stage = stages.data?.find((candidate) => candidate.id === stageId) ?? null;
  const competition = useCyclingCompetition(race.data?.id);
  const startlist = useStageStartlist(stageId);
  const [tipMode, setTipMode] = useState<GrandTourTipMode>("daily");
  const currentTip = useStageTipDraft({ competitionId: competition.data?.id, stageId, tipMode });
  const save = useSaveTipDraft();
  const submit = useSubmitTip();
  const clear = useClearTip();
  const [topFive, setTopFive] = useState<(string | null)[]>([null, null, null, null, null]);
  const [jerseys, setJerseys] = useState<Partial<Record<JerseyKey, string>>>({});
  const [activePicker, setActivePicker] = useState<ActivePicker>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const tip = currentTip.data;
    const nextTopFive: (string | null)[] = [null, null, null, null, null];
    const nextJerseys: Partial<Record<JerseyKey, string>> = {};
    tip?.selections.forEach((selection) => {
      if (selection.selection_type === "stage_top_5" && selection.predicted_position) {
        nextTopFive[selection.predicted_position - 1] = selection.rider_id;
      }
      (Object.keys(jerseySelectionType) as JerseyKey[]).forEach((jersey) => {
        if (selection.selection_type === jerseySelectionType[jersey]) nextJerseys[jersey] = selection.rider_id;
      });
    });
    setTopFive(nextTopFive);
    setJerseys(nextJerseys);
    setActivePicker(null);
    setMessage(null);
  }, [currentTip.data?.id, currentTip.data?.updated_at, tipMode]);

  const riderNames = useMemo(() => new Map(
    (startlist.data ?? []).map((entry) => [entry.rider.id, entry.rider.display_name])
  ), [startlist.data]);
  const selections = useMemo(() => buildStageTipSelections(
    topFive,
    Object.fromEntries(Object.entries(jerseys).map(([key, riderId]) => [jerseySelectionType[key as JerseyKey], riderId]))
  ), [jerseys, topFive]);
  const lockTime = tipMode === "preselection" ? race.data?.preselection_locks_at : stage?.locks_at;
  const clientLocked = Boolean(stage?.manual_locked_at)
    || Boolean(lockTime && new Date(lockTime).getTime() <= Date.now());
  const locked = clientLocked || currentTip.data?.status === "locked" || currentTip.data?.status === "scored";
  const terminalStatus = currentTip.data?.status && ["scored", "corrected", "voided", "missed", "deleted"].includes(currentTip.data.status)
    ? currentTip.data.status as TipDisplayStatus
    : null;
  const displayStatus: TipDisplayStatus = terminalStatus
    ? terminalStatus
    : clientLocked
      ? (currentTip.data ? "locked" : "missed")
      : currentTip.data?.status ?? "not_started";
  const busy = save.saving || submit.saving || clear.saving;
  const error = save.error ?? submit.error ?? clear.error;

  const selectRider = (riderId: string) => {
    if (!activePicker) return;
    if (activePicker.type === "top5") {
      setTopFive((current) => current.map((value, index) => index === activePicker.position - 1 ? riderId : value));
    } else {
      setJerseys((current) => ({ ...current, [activePicker.jersey]: riderId }));
    }
    setActivePicker(null);
    setMessage(null);
  };

  const persistDraft = async () => {
    if (!competition.data) return null;
    const tipId = await save.saveDraft({
      competitionId: competition.data.id,
      stageId,
      tipMode,
      tipScope: "stage",
      selections
    });
    setMessage("Draft saved.");
    currentTip.reload();
    return tipId;
  };

  const submitTips = async () => {
    if (!isCompleteStageTip(selections)) {
      setMessage("Choose five different riders and all four jersey holders before submitting.");
      return;
    }
    try {
      const tipId = await persistDraft();
      if (!tipId) return;
      await submit.submitTip(tipId);
      setMessage("Tips submitted successfully.");
      currentTip.reload();
    } catch {
      // RPC error is rendered below.
    }
  };

  const clearTip = async () => {
    if (!currentTip.data) return;
    try {
      await clear.clearTip(currentTip.data.id);
      setTopFive([null, null, null, null, null]);
      setJerseys({});
      setMessage("Tip cleared.");
      currentTip.reload();
    } catch {
      // RPC error is rendered below.
    }
  };

  return (
    <AppShell
      title={stage ? `Stage ${stage.stage_number} tips` : "Stage tips"}
      subtitle={stage ? `${stage.start_location ?? "TBC"} → ${stage.finish_location ?? "TBC"}` : undefined}
    >
      {stages.loading || competition.loading || currentTip.loading ? <LoadingState /> : null}
      {stages.error ? <ErrorState error={stages.error} onRetry={stages.reload} /> : null}
      {competition.error ? <ErrorState error={competition.error} onRetry={competition.reload} /> : null}
      {!stages.loading && !stages.error && !stage ? <EmptyState message="This stage could not be found." /> : null}

      {stage ? (
        <InfoCard title={stage.stage_name ?? `Stage ${stage.stage_number}`} meta={stage.stage_type.replaceAll("_", " ")}>
          <Text style={styles.copy}>Starts {formatDateTime(stage.starts_at)} · {stage.distance_km ?? "—"} km</Text>
          <Text style={locked ? styles.locked : styles.lock}>Tips lock {formatDateTime(stage.locks_at)}</Text>
          <TipStatusBadge status={displayStatus} />
          <Text style={styles.serverNote}>The server is authoritative for lock and submission checks.</Text>
        </InfoCard>
      ) : null}

      <View style={styles.tabs}>
        {(["daily", "preselection"] as GrandTourTipMode[]).map((mode) => (
          <Pressable key={mode} onPress={() => setTipMode(mode)} style={[styles.tab, tipMode === mode && styles.tabActive]}>
            <Text style={[styles.tabText, tipMode === mode && styles.tabTextActive]}>{mode}</Text>
          </Pressable>
        ))}
      </View>

      <InfoCard title="Ordered Top 5" meta={`${tipMode} entry`}>
        <Text style={styles.copy}>Select five different riders in predicted finishing order.</Text>
        <OrderedTopFivePicker
          activePosition={activePicker?.type === "top5" ? activePicker.position : null}
          disabled={locked || busy}
          onActivate={(position) => setActivePicker({ type: "top5", position })}
          onClear={(position) => setTopFive((current) => current.map((value, index) => index === position - 1 ? null : value))}
          riderName={(id) => riderNames.get(id) ?? "Unknown rider"}
          topFive={topFive}
        />
      </InfoCard>

      <InfoCard title="Jersey holders after this stage" meta="Daily jerseys">
        <Text style={styles.copy}>The same rider may be selected for more than one jersey.</Text>
        <JerseyHolderPicker
          activeJersey={activePicker?.type === "jersey" ? activePicker.jersey : null}
          disabled={locked || busy}
          onActivate={(jersey) => setActivePicker({ type: "jersey", jersey })}
          riderName={(id) => riderNames.get(id) ?? "Unknown rider"}
          selections={jerseys}
        />
      </InfoCard>

      {activePicker && startlist.data ? (
        <RiderSelectionPanel
          excludedRiderIds={activePicker.type === "top5" ? topFive.filter((id): id is string => Boolean(id)) : []}
          onSelect={selectRider}
          riders={startlist.data}
          title={activePicker.type === "top5" ? `Choose position ${activePicker.position}` : `Choose ${activePicker.jersey} jersey holder`}
        />
      ) : null}
      {startlist.loading ? <LoadingState /> : null}
      {startlist.error ? <ErrorState error={startlist.error} onRetry={startlist.reload} /> : null}

      {currentTip.data?.status === "draft" ? (
        <Text style={styles.warning}>You have saved a draft, but it has not been submitted. Only submitted tips can score points.</Text>
      ) : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!locked ? (
        <View style={styles.actions}>
          <Pressable disabled={busy || !competition.data} onPress={() => void persistDraft().catch(() => undefined)} style={[styles.secondaryButton, busy && styles.disabled]}>
            <Text style={styles.secondaryButtonText}>Save Draft</Text>
          </Pressable>
          <Pressable disabled={busy || !competition.data} onPress={() => void submitTips()} style={[styles.primaryButton, busy && styles.disabled]}>
            <Text style={styles.primaryButtonText}>Submit Tips</Text>
          </Pressable>
          {currentTip.data && ["draft", "submitted"].includes(currentTip.data.status) ? (
            <Pressable disabled={busy} onPress={() => void clearTip()} style={styles.clearButton}>
              <Text style={styles.clearButtonText}>Clear tip</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {currentTip.data?.score ? <ScoreBreakdown score={currentTip.data.score} /> : null}
      {locked ? (
        <Pressable onPress={() => router.push(`/stages/${stageId}/compare?mode=${tipMode}`)} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Compare league tips</Text>
        </Pressable>
      ) : null}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
  clearButton: { alignItems: "center", minHeight: 42, justifyContent: "center" },
  clearButtonText: { color: "#A12622", fontWeight: "800" },
  copy: { color: "#536159", fontSize: 14, lineHeight: 20 },
  disabled: { opacity: 0.5 },
  error: { color: "#A12622", fontSize: 14, fontWeight: "800" },
  lock: { color: "#12372A", fontSize: 14, fontWeight: "800" },
  locked: { color: "#A12622", fontSize: 14, fontWeight: "800" },
  message: { color: "#176B3A", fontSize: 14, fontWeight: "800" },
  primaryButton: { alignItems: "center", backgroundColor: "#12372A", borderRadius: 10, justifyContent: "center", minHeight: 50 },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "900" },
  secondaryButton: { alignItems: "center", borderColor: "#12372A", borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 50 },
  secondaryButtonText: { color: "#12372A", fontWeight: "900" },
  serverNote: { color: "#68746D", fontSize: 11 },
  tab: { alignItems: "center", borderRadius: 8, flex: 1, padding: 10 },
  tabActive: { backgroundColor: "#12372A" },
  tabText: { color: "#536159", fontWeight: "800", textTransform: "capitalize" },
  tabTextActive: { color: "#FFFFFF" },
  tabs: { backgroundColor: "#EEF2EF", borderRadius: 10, flexDirection: "row", padding: 4 },
  warning: { backgroundColor: "#FFF3CD", borderRadius: 8, color: "#6F5200", fontSize: 14, fontWeight: "800", lineHeight: 20, padding: 12 }
});
