import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  getGrandTourRidersByIds,
  getUciRidersByIds,
  listUciRiderReviewQueue,
  type GrandTourRiderRecord,
  type UciRiderRecord,
  type UciRiderReviewQueueItem
} from "@tipping-suite/supabase-client";

import { useAuth } from "../../auth/useAuth";
import { useAsyncData } from "../../hooks/useAsyncData";
import { useGrandTourAdminAccess } from "../../hooks/useGrandTourAdmin";
import { AppShell } from "../../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/DataState";
import { UciRiderReviewAccordion } from "../../components/UciRiderReviewAccordion";
import { ui } from "../../components/theme";
import { buildQueueCountsLabel, extractCandidateRiderIds } from "../../lib/uciRiderReviewExperience";

type ReviewQueueWithLookups = {
  items: UciRiderReviewQueueItem[];
  sourceRidersById: Map<string, GrandTourRiderRecord>;
  candidatesById: Map<string, UciRiderRecord>;
};

/**
 * Admin-only UCI rider review page: lists pending public.uci_rider_review_queue
 * items (from scripts/tdf-2026-registry-match-report.mjs --apply or any
 * other future writer of that table), batch-loads the referenced
 * grandtour_riders/uci_riders rows for the comparison panel, and lets an
 * admin Confirm Match / Approve as New Rider / Ignore / Flag for Source
 * Correction. Reuses useGrandTourAdminAccess() exactly like
 * app/admin/grandtour-stages.tsx - no new access hook.
 */
export default function UciRiderReviewScreen() {
  const { user } = useAuth();
  const access = useGrandTourAdminAccess();

  const loadQueue = useCallback(async (): Promise<ReviewQueueWithLookups> => {
    const items = await listUciRiderReviewQueue({ status: "pending" });

    const sourceRiderIds = items.map((item) => item.grandtourRiderId).filter((id): id is string => Boolean(id));
    const candidateIds = items.flatMap((item) => extractCandidateRiderIds(item));

    const [sourceRiders, candidates] = await Promise.all([
      getGrandTourRidersByIds(sourceRiderIds),
      getUciRidersByIds(candidateIds)
    ]);

    return {
      candidatesById: new Map(candidates.map((rider) => [rider.id, rider])),
      items,
      sourceRidersById: new Map(sourceRiders.map((rider) => [rider.id, rider]))
    };
  }, []);

  const queue = useAsyncData(loadQueue, []);

  if (access.loading) {
    return (
      <AppShell subtitle="Admin-only rider identity review queue." title="UCI rider review">
        <LoadingState />
      </AppShell>
    );
  }

  if (access.error) {
    return (
      <AppShell subtitle="Admin-only rider identity review queue." title="UCI rider review">
        <ErrorState error={access.error} onRetry={access.reload} />
      </AppShell>
    );
  }

  if (!access.data || !user) {
    return (
      <AppShell subtitle="Admin-only rider identity review queue." title="UCI rider review">
        <View style={styles.deniedPanel}>
          <Text style={styles.deniedTitle}>Admin access required</Text>
          <Text style={styles.deniedCopy}>
            This screen is only available to GrandTour cycling admins. Sign in with an admin account to continue.
          </Text>
        </View>
      </AppShell>
    );
  }

  const items = queue.data?.items ?? [];

  return (
    <AppShell subtitle="Confirm or reject candidate UCI identity matches by hand." title="UCI rider review">
      {queue.loading ? <LoadingState /> : null}
      {queue.error ? <ErrorState error={queue.error} onRetry={queue.reload} /> : null}
      {!queue.loading && !queue.error && items.length === 0 ? (
        <EmptyState message="No pending review items - every startlist rider has been matched or resolved." title="Queue is empty" />
      ) : null}
      {!queue.loading && !queue.error && items.length > 0 ? (
        <>
          <Text style={styles.countsLabel}>{buildQueueCountsLabel(items)}</Text>
          {items.map((item) => (
            <UciRiderReviewAccordion
              candidates={extractCandidateRiderIds(item)
                .map((id) => queue.data?.candidatesById.get(id))
                .filter((rider): rider is UciRiderRecord => Boolean(rider))}
              currentUserId={user.id}
              item={item}
              key={item.id}
              onActionComplete={queue.reload}
              sourceRider={item.grandtourRiderId ? queue.data?.sourceRidersById.get(item.grandtourRiderId) ?? null : null}
            />
          ))}
        </>
      ) : null}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  countsLabel: { color: ui.colors.muted, fontSize: 13, fontWeight: "700" },
  deniedCopy: { color: ui.colors.muted, fontSize: 15, lineHeight: 21, marginTop: 4 },
  deniedPanel: {
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.large,
    borderWidth: 1,
    padding: 16,
    ...ui.shadow
  },
  deniedTitle: { color: ui.colors.ink, fontSize: 16, fontWeight: "800" }
});
