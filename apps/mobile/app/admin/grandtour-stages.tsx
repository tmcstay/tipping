import { StyleSheet, Text, View } from "react-native";

import { useAuth } from "../../auth/useAuth";
import { AppShell } from "../../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/DataState";
import { GrandTourStageAdminCard } from "../../components/GrandTourStageAdminCard";
import { ui } from "../../components/theme";
import { useTdf2026Race } from "../../hooks/useCyclingData";
import {
  useGrandTourAdminAccess,
  useGrandTourStageAdminSummaries,
  useGrandTourStageNotificationSummaries
} from "../../hooks/useGrandTourAdmin";

/**
 * Admin-only GrandTour stage review panel: mark-checked -> finalise ->
 * score, via mark_grandtour_stage_result_checked/
 * finalize_grandtour_stage_result/recalculate_grandtour_stage_scores only.
 * Requirement #9 ("confirm current user is admin before showing controls")
 * is enforced below - useGrandTourAdminAccess must resolve true before any
 * stage card (and therefore any button) renders.
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

  if (access.loading) {
    return (
      <AppShell subtitle="Admin-only stage workflow controls." title="GrandTour stage review">
        <LoadingState />
      </AppShell>
    );
  }

  if (access.error) {
    return (
      <AppShell subtitle="Admin-only stage workflow controls." title="GrandTour stage review">
        <ErrorState error={access.error} onRetry={access.reload} />
      </AppShell>
    );
  }

  if (!access.data || !user) {
    return (
      <AppShell subtitle="Admin-only stage workflow controls." title="GrandTour stage review">
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

  return (
    <AppShell
      subtitle="Mark checked, finalise, and score stages via the workflow RPCs only."
      title="GrandTour stage review"
    >
      {loading ? <LoadingState /> : null}
      {race.error ? <ErrorState error={race.error} onRetry={race.reload} /> : null}
      {summaries.error ? <ErrorState error={summaries.error} onRetry={summaries.reload} /> : null}
      {!loading && !race.error && !summaries.error && (summaries.data ?? []).length === 0 ? (
        <EmptyState message="No stages found for this grand tour yet." />
      ) : null}
      {(summaries.data ?? []).map((summary) => {
        const notificationCounts = notificationCountsByStageId.get(summary.stageId);
        return (
          <View key={summary.stageId}>
            <GrandTourStageAdminCard
              currentUserId={user.id}
              grandTourName={race.data?.name ?? "Tour de France"}
              grandTourYear={race.data?.year ?? 2026}
              onActionComplete={reloadSummaries}
              summary={summary}
            />
            {notificationCounts ? (
              <Text style={styles.notificationLine}>
                Stage-result emails — pending {notificationCounts.pending}, sent {notificationCounts.sent}, failed{" "}
                {notificationCounts.failed}, skipped {notificationCounts.skipped}
              </Text>
            ) : null}
          </View>
        );
      })}
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
  notificationLine: {
    color: ui.colors.muted,
    fontSize: 12,
    marginBottom: 16,
    marginTop: -8,
    paddingHorizontal: 4
  }
});
