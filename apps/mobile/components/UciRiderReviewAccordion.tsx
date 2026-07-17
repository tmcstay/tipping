import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { GrandTourRiderRecord, UciRiderRecord, UciRiderReviewQueueItem } from "@tipping-suite/supabase-client";

import { formatQueueStatusLabel, formatQueueTypeLabel } from "../lib/uciRiderReviewExperience";
import { UciRiderReviewCard } from "./UciRiderReviewCard";
import { ui } from "./theme";

/**
 * One collapsed-by-default accordion per review-queue item, modeled
 * directly on GrandTourStageAdminAccordion: a Pressable header (source
 * rider name, queue-type badge, status) with a chevron, body only mounted
 * while expanded.
 */
export function UciRiderReviewAccordion({
  candidates,
  currentUserId,
  item,
  onActionComplete,
  sourceRider
}: {
  candidates: UciRiderRecord[];
  currentUserId: string;
  item: UciRiderReviewQueueItem;
  onActionComplete: () => void;
  sourceRider: GrandTourRiderRecord | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const entryName = sourceRider?.displayName
    ?? (item.candidatePayload && typeof item.candidatePayload === "object" && !Array.isArray(item.candidatePayload)
      ? String((item.candidatePayload as Record<string, unknown>).entryName ?? "Unknown rider")
      : "Unknown rider");

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityLabel={`${entryName}${expanded ? ", collapse" : ", expand"} — ${formatQueueTypeLabel(item.queueType)}, ${formatQueueStatusLabel(item.status)}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={() => setExpanded((value) => !value)}
        style={styles.header}
      >
        <View style={styles.headerTopRow}>
          <Text numberOfLines={1} style={styles.title}>{entryName}</Text>
          <Text style={styles.chevron}>{expanded ? "▲" : "▼"}</Text>
        </View>
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{formatQueueTypeLabel(item.queueType)}</Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{formatQueueStatusLabel(item.status)}</Text>
          </View>
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          <UciRiderReviewCard
            candidates={candidates}
            currentUserId={currentUserId}
            item={item}
            onActionComplete={onActionComplete}
            sourceRider={sourceRider}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: ui.colors.surfaceMuted, borderRadius: ui.radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  badgeText: { color: ui.colors.muted, fontSize: 11, fontWeight: "800" },
  body: { borderTopColor: ui.colors.border, borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  card: { backgroundColor: ui.colors.surface, borderColor: ui.colors.border, borderRadius: ui.radius.large, borderWidth: 1, padding: 16, ...ui.shadow },
  chevron: { color: ui.colors.primary, fontSize: 14, fontWeight: "900", marginLeft: 8 },
  header: { minHeight: 44 },
  headerTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  title: { color: ui.colors.ink, flex: 1, fontSize: 16, fontWeight: "900" }
});
