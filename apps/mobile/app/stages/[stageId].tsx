import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { GrandTourTipMode } from "@tipping-suite/shared-types";
import {
  buildStageTipSelections,
  buildTeamTimeTrialTipSelections,
  isCompleteStageTip,
  isCompleteTeamTimeTrialTip
} from "@tipping-suite/tipping-core";

import { AppShell } from "../../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/DataState";
import { InfoCard } from "../../components/InfoCard";
import { JerseyHolderPicker, type JerseyKey } from "../../components/JerseyHolderPicker";
import { OrderedTopFivePicker } from "../../components/OrderedTopFivePicker";
import { RiderSelectionPanel } from "../../components/RiderSelectionPanel";
import { ScoreBreakdown } from "../../components/ScoreBreakdown";
import { TeamSelectionPanel, type StageTeam } from "../../components/TeamSelectionPanel";
import { StageTypeBadge } from "../../components/StageTypeBadge";
import { TipStatusBadge, type TipDisplayStatus } from "../../components/TipStatusBadge";
import { TttResultSummary } from "../../components/TttResultSummary";
import {
  useCyclingCompetition,
  useStageResult,
  useStageStartlist,
  useTdf2026Stages
} from "../../hooks/useCyclingData";
import {
  GRANDTOUR_TIPPING_UNAVAILABLE_MESSAGE,
  useClearTip,
  useGrandTourTipEntryAvailability,
  useSaveTipDraft,
  useStageTipDraft,
  useSubmitTip
} from "../../hooks/useGrandTourTips";
import { formatDurationUntil, formatRiderDisplayName, formatShortDate, formatTime, preferStageBibNumber } from "../../lib/formatters";
import { getStageTipExperience } from "../../lib/stageExperience";
import { getMissingTipFields } from "../../lib/tipEntryExperience";

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
  const experience = getStageTipExperience(stage?.stage_type);
  const isTtt = experience.isTtt;
  const competition = useCyclingCompetition(race.data?.id);
  const startlist = useStageStartlist(stageId);
  const stageResult = useStageResult(stageId);
  const [tipMode, setTipMode] = useState<GrandTourTipMode>("daily");
  const currentTip = useStageTipDraft({ competitionId: competition.data?.id, stageId, tipMode });
  const save = useSaveTipDraft();
  const submit = useSubmitTip();
  const clear = useClearTip();
  const tipEntryAvailability = useGrandTourTipEntryAvailability();
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
        nextTopFive[selection.predicted_position - 1] = isTtt
          ? selection.team_id ?? null
          : selection.rider_id ?? null;
      }
      (Object.keys(jerseySelectionType) as JerseyKey[]).forEach((jersey) => {
        if (selection.selection_type === jerseySelectionType[jersey] && selection.rider_id) {
          nextJerseys[jersey] = selection.rider_id;
        }
      });
    });
    setTopFive(nextTopFive);
    setJerseys(nextJerseys);
    setActivePicker(null);
    setMessage(null);
  }, [currentTip.data?.id, currentTip.data?.updated_at, isTtt, tipMode]);

  const riderNames = useMemo(() => new Map(
    (startlist.data ?? []).map((entry) => [
      entry.rider.id,
      formatRiderDisplayName(
        entry.rider.display_name,
        preferStageBibNumber(entry.bib_number, entry.rider.bib_number)
      )
    ])
  ), [startlist.data]);
  const stageTeams = useMemo(() => Array.from(new Map(
    (startlist.data ?? [])
      .filter((entry) => entry.team !== null)
      .map((entry) => [entry.team!.id, entry.team!] as const)
  ).values()) as StageTeam[], [startlist.data]);
  const teamNames = useMemo(() => new Map(stageTeams.map((team) => [team.id, team.name])), [stageTeams]);
  const jerseySelections = useMemo(() => Object.fromEntries(
    Object.entries(jerseys).map(([key, riderId]) => [jerseySelectionType[key as JerseyKey], riderId])
  ), [jerseys]);
  const selections = useMemo(() => isTtt
    ? buildTeamTimeTrialTipSelections(topFive, jerseySelections)
    : buildStageTipSelections(topFive, jerseySelections), [isTtt, jerseySelections, topFive]);
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
  const tipEntryEnabled = tipEntryAvailability.data === true;
  const tipEntryUnavailable = !tipEntryAvailability.loading && !tipEntryEnabled;
  const completedTopFive = topFive.filter(Boolean).length;
  const completedJerseys = Object.keys(jerseys).length;
  const complete = isTtt
    ? isCompleteTeamTimeTrialTip(selections)
    : isCompleteStageTip(selections);
  const missingFields = getMissingTipFields(topFive, jerseys, isTtt);

  const selectItem = (itemId: string) => {
    if (!tipEntryEnabled || !activePicker) return;
    if (activePicker.type === "top5") {
      setTopFive((current) => current.map((value, index) => index === activePicker.position - 1 ? itemId : value));
    } else {
      setJerseys((current) => ({ ...current, [activePicker.jersey]: itemId }));
    }
    setActivePicker(null);
    setMessage(null);
  };

  const persistDraft = async () => {
    if (!tipEntryEnabled || !competition.data) return null;
    const tipId = await save.saveDraft({
      competitionId: competition.data.id,
      stageId,
      tipMode,
      tipScope: "stage",
      selections
    });
    setMessage("Draft saved. Remember to submit before tips lock.");
    currentTip.reload();
    return tipId;
  };

  const submitTips = async () => {
    if (!tipEntryEnabled) return;
    if (!complete) {
      setMessage(missingFields[0] ?? (isTtt
        ? "Choose five different teams before submitting."
        : "Choose five different riders before submitting."));
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
    if (!tipEntryEnabled || !currentTip.data) return;
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
        <InfoCard
          accent
          title={stage.stage_name ?? `Stage ${stage.stage_number}`}
          meta={`${formatShortDate(stage.starts_at)} · Stage ${stage.stage_number}`}
        >
          <View style={styles.summaryTopRow}>
            <StageTypeBadge stageType={stage.stage_type} />
            <Text style={styles.summaryDistance}>{stage.distance_km ? `${stage.distance_km} km` : "Distance TBC"}</Text>
          </View>
          <Text style={styles.summaryRoute}>{stage.start_location ?? "TBC"} → {stage.finish_location ?? "TBC"}</Text>
          <Text style={styles.summaryCopy}>{experience.isTtt ? "Team Time Trial stage: pick the top 5 teams for the stage result. Jersey tips are still individual riders." : "Pick your top 5 riders for the stage result, then select the jersey holders."}</Text>
          <View style={styles.summaryStatusRow}>
            <TipStatusBadge status={displayStatus} />
            <Text style={styles.summaryLock}>{locked ? "Tips are locked for this stage." : `Locks ${formatTime(lockTime ?? null)} · ${formatDurationUntil(lockTime ?? null)}`}</Text>
          </View>
        </InfoCard>
      ) : null}

      <View style={styles.tabs}>
        {(["daily", "preselection"] as GrandTourTipMode[]).map((mode) => (
          <Pressable key={mode} onPress={() => setTipMode(mode)} style={[styles.tab, tipMode === mode && styles.tabActive]}>
            <Text style={[styles.tabText, tipMode === mode && styles.tabTextActive]}>{mode === "daily" ? "Stage tips" : "Pre-race"}</Text>
          </Pressable>
        ))}
      </View>

      <InfoCard title={experience.topFiveTitle} meta={`${completedTopFive}/5 selected`}>
        <Text style={styles.copy}>{experience.topFiveCopy}</Text>
        <OrderedTopFivePicker
          activePosition={activePicker?.type === "top5" ? activePicker.position : null}
          disabled={locked || busy || !tipEntryEnabled}
          itemLabel={experience.topFivePicker}
          itemName={(id) => isTtt ? teamNames.get(id) ?? "Unknown team" : riderNames.get(id) ?? "Unknown rider"}
          onActivate={(position) => setActivePicker({ type: "top5", position })}
          onClear={(position) => setTopFive((current) => current.map((value, index) => index === position - 1 ? null : value))}
          topFive={topFive}
        />
      </InfoCard>

      <InfoCard title="Jersey picks" meta={`${completedJerseys}/4 selected`}>
        <Text style={styles.copy}>{isTtt ? "Jersey points are based on the official individual jersey holders after the stage." : "The same rider may be selected for more than one jersey."}</Text>
        <JerseyHolderPicker
          activeJersey={activePicker?.type === "jersey" ? activePicker.jersey : null}
          disabled={locked || busy || !tipEntryEnabled}
          onActivate={(jersey) => setActivePicker({ type: "jersey", jersey })}
          riderName={(id) => riderNames.get(id) ?? "Unknown rider"}
          selections={jerseys}
        />
      </InfoCard>

      <InfoCard title="Review and submit" meta={complete ? "Ready" : "Incomplete"}>
        <Text style={styles.copy}>{isTtt ? "Stage result picks are teams. Jersey picks are individual riders." : "Check your ordered Top 5 and jersey picks before submitting."}</Text>
        <Text style={styles.reviewHeading}>Stage Result Picks</Text>
        <View style={styles.reviewList}>
          {topFive.map((id, index) => (
            <View key={`review-top5-${index}`} style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>{index + 1}. {isTtt ? "Team" : "Rider"}</Text>
              <Text style={id ? styles.reviewValue : styles.reviewMissing}>{id ? (isTtt ? teamNames.get(id) ?? "Unknown team" : riderNames.get(id) ?? "Unknown rider") : "Missing"}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.reviewHeading}>Jersey Picks</Text>
        <View style={styles.reviewList}>
          {(["yellow", "green", "kom", "white"] as JerseyKey[]).map((jersey) => (
            <View key={`review-${jersey}`} style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>{jersey === "kom" ? "Polka Dot" : `${jersey.charAt(0).toUpperCase()}${jersey.slice(1)}`}</Text>
              <Text style={jerseys[jersey] ? styles.reviewValue : styles.reviewMissing}>{jerseys[jersey] ? riderNames.get(jerseys[jersey]!) ?? "Unknown rider" : "Missing"}</Text>
            </View>
          ))}
        </View>
        {!complete ? <View style={styles.warningInline}>{missingFields.map((field) => <Text key={field} style={styles.warningLine}>• {field}</Text>)}</View> : null}
      </InfoCard>

      {tipEntryEnabled && activePicker?.type === "top5" && isTtt ? (
        <TeamSelectionPanel
          excludedTeamIds={topFive.filter((id): id is string => Boolean(id))}
          onSelect={selectItem}
          teams={stageTeams}
          title={`Choose team for position ${activePicker.position}`}
        />
      ) : null}
      {tipEntryEnabled && activePicker && startlist.data && (!isTtt || activePicker.type === "jersey") ? (
        <RiderSelectionPanel
          excludedRiderIds={activePicker.type === "top5" ? topFive.filter((id): id is string => Boolean(id)) : []}
          onSelect={selectItem}
          riders={startlist.data}
          title={activePicker.type === "top5" ? `Choose rider for position ${activePicker.position}` : `Choose ${activePicker.jersey} jersey holder`}
        />
      ) : null}
      {startlist.loading ? <LoadingState /> : null}
      {startlist.error ? <ErrorState error={startlist.error} onRetry={startlist.reload} /> : null}
      {stageResult.error ? <ErrorState error={stageResult.error} onRetry={stageResult.reload} /> : null}

      {currentTip.data?.status === "draft" ? (
        <View style={styles.warning}><Text style={styles.warningTitle}>Draft only</Text><Text style={styles.warningLine}>Draft tips are not entered until you submit them.</Text></View>
      ) : null}
      {tipEntryUnavailable ? <View style={styles.warning}><Text style={styles.warningLine}>{GRANDTOUR_TIPPING_UNAVAILABLE_MESSAGE}</Text></View> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!locked && tipEntryEnabled ? (
        <View style={styles.actions}>
          <Pressable disabled={busy || !competition.data} onPress={() => void persistDraft().catch(() => undefined)} style={[styles.secondaryButton, busy && styles.disabled]}>
            <Text style={styles.secondaryButtonText}>Save Draft</Text>
          </Pressable>
          <Pressable disabled={busy || !competition.data} onPress={() => void submitTips()} style={[styles.primaryButton, busy && styles.disabled]}>
            <Text style={styles.primaryButtonText}>{currentTip.data?.status === "submitted" ? "Update Submitted Tips" : "Submit Tips"}</Text>
          </Pressable>
          {currentTip.data && ["draft", "submitted"].includes(currentTip.data.status) ? (
            <Pressable disabled={busy} onPress={() => void clearTip()} style={styles.clearButton}>
              <Text style={styles.clearButtonText}>Clear tip</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {currentTip.data?.score && isTtt && stageResult.loading ? <LoadingState /> : null}
      {currentTip.data?.score && isTtt && !stageResult.loading ? (
        <TttResultSummary
          result={stageResult.data ?? null}
          score={currentTip.data.score}
        />
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
  primaryButton: { alignItems: "center", backgroundColor: "#12372A", borderRadius: 14, justifyContent: "center", minHeight: 52 },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "900" },
  secondaryButton: { alignItems: "center", borderColor: "#12372A", borderRadius: 14, borderWidth: 1, justifyContent: "center", minHeight: 50 },
  secondaryButtonText: { color: "#12372A", fontWeight: "900" },
  serverNote: { color: "#68746D", fontSize: 11 },
  summaryCopy: { color: "#E7F1EA", fontSize: 14, lineHeight: 20 },
  summaryDistance: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  summaryLock: { color: "#E7F1EA", flex: 1, fontSize: 12, fontWeight: "800", textAlign: "right" },
  summaryRoute: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  summaryStatusRow: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  summaryTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  reviewLabel: { color: "#68746D", fontSize: 12, fontWeight: "900", minWidth: 86, textTransform: "uppercase" },
  reviewHeading: { color: "#17231C", fontSize: 13, fontWeight: "900", marginTop: 4 },
  reviewList: { backgroundColor: "#F7FAF8", borderColor: "#E0E8E2", borderRadius: 14, borderWidth: 1, gap: 0, overflow: "hidden" },
  reviewMissing: { color: "#A12622", flex: 1, fontSize: 13, fontWeight: "900", textAlign: "right" },
  reviewRow: { alignItems: "center", borderBottomColor: "#E0E8E2", borderBottomWidth: 1, flexDirection: "row", gap: 8, minHeight: 42, paddingHorizontal: 12, paddingVertical: 8 },
  reviewValue: { color: "#12372A", flex: 1, fontSize: 13, fontWeight: "900", textAlign: "right" },
  tab: { alignItems: "center", borderRadius: 12, flex: 1, padding: 11 },
  tabActive: { backgroundColor: "#12372A" },
  tabText: { color: "#536159", fontWeight: "800", textTransform: "capitalize" },
  tabTextActive: { color: "#FFFFFF" },
  tabs: { backgroundColor: "#EEF2EF", borderRadius: 14, flexDirection: "row", padding: 4 },
  warning: { backgroundColor: "#FFF3CD", borderRadius: 12, padding: 12 },
  warningInline: { backgroundColor: "#FFF3CD", borderRadius: 10, gap: 3, padding: 10 },
  warningLine: { color: "#6F5200", fontSize: 13, fontWeight: "800", lineHeight: 19 },
  warningTitle: { color: "#6F5200", fontSize: 14, fontWeight: "900", marginBottom: 2 }
});
