import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  buildOverallJerseySelections,
  isCompleteOverallJerseyTip
} from "@tipping-suite/tipping-core";
import type { CyclingStartlistRider } from "@tipping-suite/supabase-client";

import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState } from "../components/DataState";
import { InfoCard } from "../components/InfoCard";
import { JerseyHolderPicker, type JerseyKey } from "../components/JerseyHolderPicker";
import { RiderSelectionPanel } from "../components/RiderSelectionPanel";
import { ScoreBreakdown } from "../components/ScoreBreakdown";
import { TipStatusBadge, type TipDisplayStatus } from "../components/TipStatusBadge";
import { useCyclingCompetition, useTdfRiders, useTdf2026Race } from "../hooks/useCyclingData";
import {
  GRANDTOUR_TIPPING_UNAVAILABLE_MESSAGE,
  useClearTip,
  useGrandTourTipEntryAvailability,
  useOverallJerseyTip,
  useSaveTipDraft,
  useSubmitTip
} from "../hooks/useGrandTourTips";
import { formatDateTime, formatRiderDisplayName } from "../lib/formatters";

const overallType: Record<JerseyKey, "overall_yellow_winner" | "overall_green_winner" | "overall_kom_winner" | "overall_white_winner"> = {
  yellow: "overall_yellow_winner",
  green: "overall_green_winner",
  kom: "overall_kom_winner",
  white: "overall_white_winner"
};

export default function OverallJerseyTipScreen() {
  const race = useTdf2026Race();
  const competition = useCyclingCompetition(race.data?.id);
  const riders = useTdfRiders();
  const tip = useOverallJerseyTip(competition.data?.id);
  const save = useSaveTipDraft();
  const submit = useSubmitTip();
  const clear = useClearTip();
  const tipEntryAvailability = useGrandTourTipEntryAvailability();
  const [jerseys, setJerseys] = useState<Partial<Record<JerseyKey, string>>>({});
  const [activeJersey, setActiveJersey] = useState<JerseyKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const next: Partial<Record<JerseyKey, string>> = {};
    tip.data?.selections.forEach((selection) => {
      (Object.keys(overallType) as JerseyKey[]).forEach((jersey) => {
        if (selection.selection_type === overallType[jersey]) next[jersey] = selection.rider_id;
      });
    });
    setJerseys(next);
  }, [tip.data?.id, tip.data?.updated_at]);

  const riderNames = useMemo(() => new Map((riders.riders.data ?? []).map((rider) => [
    rider.id,
    formatRiderDisplayName(rider.display_name, rider.bib_number)
  ])), [riders.riders.data]);
  const riderChoices: CyclingStartlistRider[] = useMemo(() => (riders.riders.data ?? []).map((rider) => ({
    id: rider.id,
    status: "confirmed",
    bib_number: null,
    rider_role: rider.rider_type,
    rider: { id: rider.id, bib_number: rider.bib_number, display_name: rider.display_name, nationality: rider.nationality, rider_type: rider.rider_type },
    team: null
  })), [riders.riders.data]);
  const selections = useMemo(() => buildOverallJerseySelections(
    Object.fromEntries(Object.entries(jerseys).map(([key, riderId]) => [overallType[key as JerseyKey], riderId]))
  ), [jerseys]);
  const clientLocked = Boolean(race.data && new Date(race.data.preselection_locks_at).getTime() <= Date.now());
  const locked = clientLocked || tip.data?.status === "locked" || tip.data?.status === "scored";
  const terminalStatus = tip.data?.status && ["scored", "corrected", "voided", "missed", "deleted"].includes(tip.data.status)
    ? tip.data.status as TipDisplayStatus
    : null;
  const status: TipDisplayStatus = terminalStatus
    ? terminalStatus
    : clientLocked
      ? (tip.data ? "locked" : "missed")
      : tip.data?.status ?? "not_started";
  const busy = save.saving || submit.saving || clear.saving;
  const error = save.error ?? submit.error ?? clear.error;
  const tipEntryEnabled = tipEntryAvailability.data === true;
  const tipEntryUnavailable = !tipEntryAvailability.loading && !tipEntryEnabled;

  const persist = async () => {
    if (!tipEntryEnabled || !competition.data) return null;
    const tipId = await save.saveDraft({ competitionId: competition.data.id, stageId: null, tipMode: "preselection", tipScope: "overall_jerseys", selections });
    setMessage("Draft saved.");
    tip.reload();
    return tipId;
  };
  const submitTips = async () => {
    if (!tipEntryEnabled) return;
    if (!isCompleteOverallJerseyTip(selections)) {
      setMessage("Choose all four overall jersey winners before submitting.");
      return;
    }
    try {
      const tipId = await persist();
      if (tipId) await submit.submitTip(tipId);
      setMessage("Overall jersey tips submitted successfully.");
      tip.reload();
    } catch { /* Server error is displayed below. */ }
  };
  const clearTip = async () => {
    if (!tipEntryEnabled || !tip.data) return;
    try {
      await clear.clearTip(tip.data.id);
      setJerseys({});
      setMessage("Tip cleared.");
      tip.reload();
    } catch { /* Server error is displayed below. */ }
  };

  return (
    <AppShell title="Overall jersey winners" subtitle="Tour-level preselection picks">
      {race.loading || competition.loading || riders.riders.loading || tip.loading ? <LoadingState /> : null}
      {race.error ? <ErrorState error={race.error} onRetry={race.reload} /> : null}
      {riders.riders.error ? <ErrorState error={riders.riders.error} onRetry={riders.riders.reload} /> : null}
      <InfoCard title="Overall jersey winners" meta="Preselection">
        <Text style={styles.copy}>Pick the rider who will win each jersey at the end of the tour.</Text>
        <Text style={styles.lock}>Locks {race.data ? formatDateTime(race.data.preselection_locks_at) : "—"}</Text>
        <TipStatusBadge status={status} />
        <JerseyHolderPicker activeJersey={activeJersey} disabled={locked || busy || !tipEntryEnabled} onActivate={setActiveJersey} riderName={(id) => riderNames.get(id) ?? "Unknown rider"} selections={jerseys} />
      </InfoCard>
      {tipEntryEnabled && activeJersey ? <RiderSelectionPanel riders={riderChoices} title={`Choose overall ${activeJersey} winner`} onSelect={(riderId) => { setJerseys((current) => ({ ...current, [activeJersey]: riderId })); setActiveJersey(null); }} /> : null}
      {tip.data?.status === "draft" ? <Text style={styles.warning}>You have saved a draft, but it has not been submitted. Only submitted tips can score points.</Text> : null}
      {tipEntryUnavailable ? <Text style={styles.warning}>{GRANDTOUR_TIPPING_UNAVAILABLE_MESSAGE}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!locked && tipEntryEnabled ? <View style={styles.actions}>
        <Pressable disabled={busy} onPress={() => void persist().catch(() => undefined)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Save Draft</Text></Pressable>
        <Pressable disabled={busy} onPress={() => void submitTips()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Submit Tips</Text></Pressable>
        {tip.data && ["draft", "submitted"].includes(tip.data.status) ? <Pressable disabled={busy} onPress={() => void clearTip()} style={styles.clearButton}><Text style={styles.clearButtonText}>Clear tip</Text></Pressable> : null}
      </View> : null}
      {tip.data?.score ? <ScoreBreakdown score={tip.data.score} /> : null}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
  clearButton: { alignItems: "center", minHeight: 42, justifyContent: "center" },
  clearButtonText: { color: "#A12622", fontWeight: "800" },
  copy: { color: "#536159", fontSize: 14, lineHeight: 20 },
  error: { color: "#A12622", fontWeight: "800" },
  lock: { color: "#12372A", fontSize: 13, fontWeight: "800" },
  message: { color: "#176B3A", fontWeight: "800" },
  primaryButton: { alignItems: "center", backgroundColor: "#12372A", borderRadius: 10, justifyContent: "center", minHeight: 50 },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "900" },
  secondaryButton: { alignItems: "center", borderColor: "#12372A", borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 50 },
  secondaryButtonText: { color: "#12372A", fontWeight: "900" },
  warning: { backgroundColor: "#FFF3CD", borderRadius: 8, color: "#6F5200", fontSize: 14, fontWeight: "800", lineHeight: 20, padding: 12 }
});
