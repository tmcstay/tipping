import { resolveCyclingStageClosureState, resolveCyclingStageLockAt } from "@tipping-suite/tipping-core";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CyclingStage } from "@tipping-suite/supabase-client";

import { AppShell } from "../../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/DataState";
import { InfoCard } from "../../components/InfoCard";
import { StageLockCountdown } from "../../components/StageLockCountdown";
import { StageStatusBadge } from "../../components/StageStatusBadge";
import { StageTypeBadge } from "../../components/StageTypeBadge";
import { ui } from "../../components/theme";
import { useCyclingStageResults, useTdf2026Stages } from "../../hooks/useCyclingData";
import { formatDateTime } from "../../lib/formatters";
import { formatGrandTourName } from "../../lib/grandTourDisplay";
import { getStageTipExperience } from "../../lib/stageExperience";
import { buildClosureDisplay } from "../../lib/stageClosureExperience";
import { buildFutureStagesToggleLabel, buildStageListSections } from "../../lib/stageListExperience";

export default function StageListScreen() {
  const router = useRouter();
  const { race, stages } = useTdf2026Stages();
  const results = useCyclingStageResults(race.data?.id);
  const [showFuture, setShowFuture] = useState(false);
  const loading = race.loading || stages.loading;
  const now = new Date();

  // Latest relevant stages first; stages beyond the next upcoming one are
  // hidden behind the "Show future stages" toggle (pure, unit-tested rule
  // in lib/stageListExperience.ts).
  const sections = buildStageListSections(
    (stages.data ?? []).map((stage) => ({
      stage,
      startsAt: stage.starts_at,
      stageNumber: stage.stage_number
    })),
    now
  );

  const renderStageCard = (stage: CyclingStage) => {
    // Shared source of truth (packages/tipping-core) rather than a
    // separate hand-rolled `now >= locks_at` comparison - also picks up
    // an admin manual_locked_at override, which the old inline check
    // silently ignored.
    const isFinal = Boolean(results.data?.some((result) => result.stage_id === stage.id));
    const closureState = resolveCyclingStageClosureState({
      startsAt: stage.starts_at,
      locksAt: stage.locks_at,
      manualLockedAt: stage.manual_locked_at,
      isFinal,
      now
    });
    const display = buildClosureDisplay({
      state: closureState,
      locksAt: stage.locks_at,
      now,
      formattedLockDateTime: formatDateTime(stage.locks_at)
    });
    const experience = getStageTipExperience(stage.stage_type);
    return (
      <Pressable key={stage.id} onPress={() => router.push(`/stages/${stage.id}`)}>
        <InfoCard
          title={`Stage ${stage.stage_number}: ${stage.start_location ?? "TBC"} → ${stage.finish_location ?? "TBC"}`}
          meta={formatDateTime(stage.starts_at)}
        >
          <View style={styles.topRow}>
            <StageTypeBadge stageType={stage.stage_type} />
            <Text style={styles.distance}>{stage.distance_km ? `${stage.distance_km} km` : "Distance TBC"}</Text>
          </View>
          <View style={styles.statusRow}>
            <StageStatusBadge emphasis={display.emphasis} label={display.badgeLabel} tone={closureState} />
            {closureState === "open" || closureState === "closing_soon" ? (
              <StageLockCountdown
                lockAt={resolveCyclingStageLockAt({ locksAt: stage.locks_at, manualLockedAt: stage.manual_locked_at })}
                style={styles.primaryLabel}
              />
            ) : (
              <Text style={styles.primaryLabel}>{display.primaryLabel}</Text>
            )}
          </View>
          {/* Selection instructions only make sense while the stage is still open for tipping. */}
          {display.editable && experience.isTtt ? (
            <Text style={styles.tttNote}>TTT: pick teams for the stage result.</Text>
          ) : null}
          {stage.start_time_is_estimated ? (
            <Text style={styles.provisional}>Start time is provisional</Text>
          ) : null}
        </InfoCard>
      </Pressable>
    );
  };

  return (
    <AppShell
      raceName={formatGrandTourName(race.data)}
      title="Stage tips"
      subtitle="Choose a stage, then enter or review your picks."
    >
      {/* Compact control row, top of screen: navigation shortcuts (Rider
          Directory, Favourites) alongside the actual Show Future Stages
          toggle - all three share one pill treatment so they read as a
          single control group, even though only the third one is a real
          toggle for this screen. Wraps cleanly on narrow widths. */}
      <View style={styles.controlRow}>
        <Link asChild href="/riders">
          <Pressable accessibilityRole="button" style={styles.pill}>
            <Text style={styles.pillText}>Rider Directory</Text>
          </Pressable>
        </Link>
        <Link asChild href="/riders?filter=favourites">
          <Pressable accessibilityRole="button" style={styles.pill}>
            <Text style={styles.pillText}>Favourites</Text>
          </Pressable>
        </Link>
        {sections.future.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showFuture }}
            onPress={() => setShowFuture((current) => !current)}
            style={[styles.pill, showFuture && styles.pillActive]}
          >
            <Text style={[styles.pillText, showFuture && styles.pillTextActive]}>
              {buildFutureStagesToggleLabel(showFuture, sections.future.length)}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? <LoadingState /> : null}
      {race.error ? <ErrorState error={race.error} onRetry={race.reload} /> : null}
      {stages.error ? <ErrorState error={stages.error} onRetry={stages.reload} /> : null}
      {!loading && !race.error && !stages.error && stages.data?.length === 0 ? (
        <EmptyState message="No active stages are available yet. Check back when the next race schedule is published." />
      ) : null}
      {!loading && !race.error && !stages.error ? (
        <>
          {sections.current.map((entry) => renderStageCard(entry.stage))}
          {showFuture && sections.future.length > 0 ? (
            <>
              <Text style={styles.sectionHeading}>Future stages</Text>
              {sections.future.map((entry) => renderStageCard(entry.stage))}
            </>
          ) : null}
        </>
      ) : null}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  controlRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  distance: { color: ui.colors.muted, fontSize: 13, fontWeight: "600" },
  pill: {
    alignItems: "center",
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.pill,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 14
  },
  pillActive: {
    backgroundColor: ui.colors.primary,
    borderColor: ui.colors.primary
  },
  pillText: { color: ui.colors.accent, fontSize: 13, fontWeight: "700" },
  pillTextActive: { color: "#FFFFFF" },
  primaryLabel: { color: ui.colors.muted, fontSize: 13, fontWeight: "600" },
  provisional: { color: ui.colors.warning, fontSize: 12, fontWeight: "600" },
  sectionHeading: {
    color: ui.colors.faint,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  statusRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  topRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  tttNote: { backgroundColor: ui.colors.tttSoft, borderRadius: 10, color: ui.colors.ttt, fontSize: 13, fontWeight: "600", lineHeight: 18, padding: 10 }
});
