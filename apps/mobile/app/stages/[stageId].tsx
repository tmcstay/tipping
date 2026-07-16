import { resolveCyclingStageClosureState, resolveCyclingStageLockAt } from "@tipping-suite/tipping-core";
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
import { OrderedTopFivePicker } from "../../components/OrderedTopFivePicker";
import { RiderSelectionPanel } from "../../components/RiderSelectionPanel";
import { ScoreBreakdown } from "../../components/ScoreBreakdown";
import { StageLockCountdown } from "../../components/StageLockCountdown";
import { TeamSelectionPanel, type StageTeam } from "../../components/TeamSelectionPanel";
import { StageTypeBadge } from "../../components/StageTypeBadge";
import { TipStatusBadge, type TipDisplayStatus } from "../../components/TipStatusBadge";
import { TttResultSummary } from "../../components/TttResultSummary";
import { ui } from "../../components/theme";
import {
  useCyclingCompetition,
  useStageResult,
  useStageStartlist,
  useTdf2026Stages
} from "../../hooks/useCyclingData";
import { useFavouriteRiderIds } from "../../hooks/useGrandTourFavourites";
import {
  GRANDTOUR_TIPPING_UNAVAILABLE_MESSAGE,
  useClearTip,
  useGrandTourTipEntryAvailability,
  useSaveTipDraft,
  useStageTipDraft,
  useSubmitTip
} from "../../hooks/useGrandTourTips";
import { formatRiderDisplayName, formatShortDate, formatTime, preferStageBibNumber } from "../../lib/formatters";
import { formatGrandTourName } from "../../lib/grandTourDisplay";
import { getStageTipExperience } from "../../lib/stageExperience";
import { buildTopFiveValidationMessage } from "../../lib/tipEntryExperience";

type ActivePicker = { type: "top5"; position: number } | null;

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
  const favourites = useFavouriteRiderIds(race.data?.id);
  const [tipMode, setTipMode] = useState<GrandTourTipMode>("daily");
  const currentTip = useStageTipDraft({ competitionId: competition.data?.id, stageId, tipMode });
  const save = useSaveTipDraft();
  const submit = useSubmitTip();
  const clear = useClearTip();
  const tipEntryAvailability = useGrandTourTipEntryAvailability();
  const [topFive, setTopFive] = useState<(string | null)[]>([null, null, null, null, null]);
  const [activePicker, setActivePicker] = useState<ActivePicker>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const tip = currentTip.data;
    const nextTopFive: (string | null)[] = [null, null, null, null, null];
    tip?.selections.forEach((selection) => {
      if (selection.selection_type === "stage_top_5" && selection.predicted_position) {
        nextTopFive[selection.predicted_position - 1] = isTtt
          ? selection.team_id ?? null
          : selection.rider_id ?? null;
      }
    });
    setTopFive(nextTopFive);
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
  const selections = useMemo(() => isTtt
    ? buildTeamTimeTrialTipSelections(topFive)
    : buildStageTipSelections(topFive), [isTtt, topFive]);
  const now = new Date();
  const lockTime = tipMode === "preselection" ? race.data?.preselection_locks_at : stage?.locks_at;
  // The countdown always shows the true *effective* lock instant, which for
  // "daily" mode can differ from the raw locks_at column when an admin has
  // set manual_locked_at (see resolveCyclingStageLockAt's documented
  // priority) - lockTime above stays untouched for its existing uses
  // (formatTime display, the preselection clientLocked check below).
  const effectiveLockAt = tipMode === "preselection"
    ? (race.data?.preselection_locks_at ?? null)
    : (stage ? resolveCyclingStageLockAt({ locksAt: stage.locks_at, manualLockedAt: stage.manual_locked_at }) : null);
  // "daily" mode reuses the shared, tipping-core-backed stage closure
  // resolver (same one the dashboard/stage list use); "preselection" locks
  // against a separate race-level timestamp with no equivalent shared
  // resolver, so it keeps its own simple comparison - these are genuinely
  // two different lock concepts, not a duplicated implementation of one.
  const stageClosureState = stage ? resolveCyclingStageClosureState({
    startsAt: stage.starts_at,
    locksAt: stage.locks_at,
    manualLockedAt: stage.manual_locked_at,
    now
  }) : null;
  const clientLocked = tipMode === "preselection"
    ? Boolean(lockTime && new Date(lockTime).getTime() <= now.getTime())
    : stageClosureState !== null && stageClosureState !== "open" && stageClosureState !== "closing_soon";
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
  const complete = isTtt
    ? isCompleteTeamTimeTrialTip(selections)
    : isCompleteStageTip(selections);
  const validationMessage = buildTopFiveValidationMessage(topFive, isTtt);

  const selectItem = (itemId: string) => {
    if (!tipEntryEnabled || !activePicker) return;
    if (activePicker.type === "top5") {
      setTopFive((current) => current.map((value, index) => index === activePicker.position - 1 ? itemId : value));
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
      setMessage(validationMessage);
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
      setMessage("Tip cleared.");
      currentTip.reload();
    } catch {
      // RPC error is rendered below.
    }
  };

  return (
    <AppShell
      raceName={formatGrandTourName(race.data)}
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
          {!locked ? <Text style={styles.summaryCopy}>{experience.topFiveCopy}</Text> : null}
          <View style={styles.summaryStatusRow}>
            <TipStatusBadge status={displayStatus} />
            {locked ? (
              <Text style={styles.summaryLock}>Tips are locked for this stage.</Text>
            ) : (
              <View style={styles.summaryLockRow}>
                <Text style={styles.summaryLockText}>Locks {formatTime(lockTime ?? null)} · </Text>
                <StageLockCountdown lockAt={effectiveLockAt} style={styles.summaryLockText} />
              </View>
            )}
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
        {!locked ? <Text style={styles.copy}>{experience.topFiveCopy}</Text> : null}
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

      {!locked ? (
        <Text style={[styles.validationMessage, complete && styles.validationMessageComplete]}>{validationMessage}</Text>
      ) : null}

      {tipEntryEnabled && activePicker?.type === "top5" && isTtt ? (
        <TeamSelectionPanel
          excludedTeamIds={topFive.filter((id): id is string => Boolean(id))}
          onSelect={selectItem}
          teams={stageTeams}
          title={`Choose team for position ${activePicker.position}`}
        />
      ) : null}
      {tipEntryEnabled && activePicker?.type === "top5" && startlist.data && !isTtt ? (
        <RiderSelectionPanel
          excludedRiderIds={topFive.filter((id): id is string => Boolean(id))}
          favouriteRiderIds={favourites.favouriteRiderIds}
          onClose={() => setActivePicker(null)}
          onSelect={selectItem}
          riders={startlist.data}
          stageContext={stage ? `Stage ${stage.stage_number}` : undefined}
          title="Select rider"
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
  clearButtonText: { color: ui.colors.danger, fontWeight: "700" },
  copy: { color: ui.colors.muted, fontSize: 14, lineHeight: 20 },
  disabled: { opacity: 0.5 },
  error: { color: ui.colors.danger, fontSize: 14, fontWeight: "700" },
  message: { color: ui.colors.positiveStrong, fontSize: 14, fontWeight: "700" },
  primaryButton: { alignItems: "center", backgroundColor: ui.colors.primary, borderRadius: 14, justifyContent: "center", minHeight: 52 },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "700" },
  secondaryButton: { alignItems: "center", borderColor: ui.colors.primary, borderRadius: 14, borderWidth: 1, justifyContent: "center", minHeight: 50 },
  secondaryButtonText: { color: ui.colors.primary, fontWeight: "700" },
  serverNote: { color: ui.colors.faint, fontSize: 11 },
  summaryCopy: { color: "rgba(255,255,255,0.9)", fontSize: 14, lineHeight: 20 },
  summaryDistance: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  summaryLock: { color: "rgba(255,255,255,0.9)", flex: 1, fontSize: 12, fontWeight: "600", textAlign: "right" },
  summaryLockRow: { flex: 1, flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end" },
  summaryLockText: { color: "rgba(255,255,255,0.9)", fontSize: 12, fontWeight: "600" },
  summaryRoute: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  summaryStatusRow: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  summaryTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  tab: { alignItems: "center", borderRadius: 12, flex: 1, padding: 11 },
  tabActive: { backgroundColor: ui.colors.primary },
  tabText: { color: ui.colors.muted, fontWeight: "600", textTransform: "capitalize" },
  tabTextActive: { color: "#FFFFFF" },
  tabs: { backgroundColor: ui.colors.surfaceMuted, borderRadius: 14, flexDirection: "row", padding: 4 },
  validationMessage: { backgroundColor: ui.colors.accentSoft, borderRadius: 10, color: ui.colors.accent, fontSize: 13, fontWeight: "600", lineHeight: 19, padding: 12 },
  validationMessageComplete: { backgroundColor: ui.colors.positiveSoft, color: ui.colors.positiveStrong },
  warning: { backgroundColor: ui.colors.surfaceMuted, borderRadius: 12, padding: 12 },
  warningLine: { color: ui.colors.muted, fontSize: 13, fontWeight: "600", lineHeight: 19 },
  warningTitle: { color: ui.colors.muted, fontSize: 14, fontWeight: "700", marginBottom: 2 }
});
