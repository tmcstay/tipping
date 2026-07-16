import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../../auth/useAuth";
import { AppShell } from "../../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/DataState";
import { GrandTourStageAdminAccordion } from "../../components/GrandTourStageAdminAccordion";
import { ui } from "../../components/theme";
import { useTdf2026Race } from "../../hooks/useCyclingData";
import {
  useGrandTourAdminAccess,
  useGrandTourStageAdminSummaries,
  useGrandTourStageNotificationSummaries
} from "../../hooks/useGrandTourAdmin";
import { formatGrandTourName } from "../../lib/grandTourDisplay";
import { buildFutureStagesToggleLabel, buildStageListSections } from "../../lib/stageListExperience";

/**
 * Admin-only GrandTour stage review panel: mark-checked -> finalise ->
 * score, via mark_grandtour_stage_result_checked/
 * finalize_grandtour_stage_result/recalculate_grandtour_stage_scores only.
 * Requirement #9 ("confirm current user is admin before showing controls")
 * is enforced below - useGrandTourAdminAccess must resolve true before any
 * stage card (and therefore any button) renders.
 *
 * Stages render newest-first as collapsed accordion cards (one stage - one
 * full RPC/review panel - per screenful was unusable once more than a
 * handful of stages existed). Future stages are hidden by default behind
 * the same "Show future stages" toggle/sectioning rule the public Tips
 * screen uses (buildStageListSections, lib/stageListExperience.ts) -
 * reused here rather than reimplemented, since "latest relevant stages
 * first, future stages hidden" is the identical rule for both screens.
 */
export default function GrandTourStagesAdminScreen() {
  const { user } = useAuth();
  const access = useGrandTourAdminAccess();
  const race = useTdf2026Race();
  const summaries = useGrandTourStageAdminSummaries(race.data?.id);
  const stageIds = (summaries.data ?? []).map((summary) => summary.stageId);
  const notificationSummaries = useGrandTourStageNotificationSummaries(stageIds);
  const notificationCountsByStageId = new Map(
    (notificationSummaries.data ?? []).map((entry) => [entry.stageId, entry.counts])
  );
  const [showFuture, setShowFuture] = useState(false);
  const now = new Date();

  // Display-only formatted name (e.g. "Tour de France ’26"). The raw
  // race.data?.name/year below stay untouched where they're passed through
  // to GrandTourStageAdminCard as grandTourName/grandTourYear - those are
  // lookup keys sent to the run-official-check server route, not display
  // text, and must keep matching the grand_tours row exactly.
  const raceDisplayName = formatGrandTourName(race.data);

  if (access.loading) {
    return (
      <AppShell raceName={raceDisplayName} subtitle="Admin-only stage workflow controls." title="GrandTour stage review">
        <LoadingState />
      </AppShell>
    );
  }

  if (access.error) {
    return (
      <AppShell raceName={raceDisplayName} subtitle="Admin-only stage workflow controls." title="GrandTour stage review">
        <ErrorState error={access.error} onRetry={access.reload} />
      </AppShell>
    );
  }

  if (!access.data || !user) {
    return (
      <AppShell raceName={raceDisplayName} subtitle="Admin-only stage workflow controls." title="GrandTour stage review">
        <View style={styles.deniedPanel}>
          <Text style={styles.deniedTitle}>Admin access required</Text>
          <Text style={styles.deniedCopy}>
            This screen is only available to GrandTour cycling admins. Sign in with an admin account to continue.
          </Text>
        </View>
      </AppShell>
    );
  }

  const loading = race.loading || summaries.loading;
  const reloadSummaries = summaries.reload;
  const grandTourName = race.data?.name ?? "Tour de France";
  const grandTourYear = race.data?.year ?? 2026;

  const sections = buildStageListSections(
    (summaries.data ?? []).map((summary) => ({
      summary,
      startsAt: summary.stageDate,
      stageNumber: summary.stageNumber
    })),
    now
  );

  const renderAccordion = (summary: (typeof sections.current)[number]["summary"]) => {
    const notificationCounts = notificationCountsByStageId.get(summary.stageId);
    const notificationCountsLine = notificationCounts
      ? `Stage-result emails — pending ${notificationCounts.pending}, sent ${notificationCounts.sent}, failed ${notificationCounts.failed}, skipped ${notificationCounts.skipped}`
      : null;
    return (
      <GrandTourStageAdminAccordion
        currentUserId={user.id}
        grandTourName={grandTourName}
        grandTourYear={grandTourYear}
        key={summary.stageId}
        notificationCountsLine={notificationCountsLine}
        now={now}
        onActionComplete={reloadSummaries}
        summary={summary}
      />
    );
  };

  return (
    <AppShell
      raceName={raceDisplayName}
      subtitle="Mark checked, finalise, and score stages via the workflow RPCs only."
      title="GrandTour stage review"
    >
      {loading ? <LoadingState /> : null}
      {race.error ? <ErrorState error={race.error} onRetry={race.reload} /> : null}
      {summaries.error ? <ErrorState error={summaries.error} onRetry={summaries.reload} /> : null}
      {!loading && !race.error && !summaries.error && (summaries.data ?? []).length === 0 ? (
        <EmptyState message="No stages found for this grand tour yet." />
      ) : null}
      {!loading && !race.error && !summaries.error ? (
        <>
          {sections.current.map((entry) => renderAccordion(entry.summary))}
          {sections.future.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showFuture }}
              onPress={() => setShowFuture((current) => !current)}
              style={styles.futureToggle}
            >
              <Text style={styles.futureToggleText}>
                {buildFutureStagesToggleLabel(showFuture, sections.future.length)}
              </Text>
            </Pressable>
          ) : null}
          {showFuture && sections.future.length > 0 ? (
            <>
              <Text style={styles.sectionHeading}>Future stages</Text>
              {sections.future.map((entry) => renderAccordion(entry.summary))}
            </>
          ) : null}
        </>
      ) : null}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  deniedCopy: {
    color: ui.colors.muted,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 4
  },
  deniedPanel: {
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.large,
    borderWidth: 1,
    padding: 16,
    ...ui.shadow
  },
  deniedTitle: {
    color: ui.colors.ink,
    fontSize: 16,
    fontWeight: "800"
  },
  futureToggle: {
    alignItems: "center",
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.medium,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46
  },
  futureToggleText: { color: ui.colors.accent, fontSize: 14, fontWeight: "700" },
  sectionHeading: {
    color: ui.colors.faint,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  }
});
