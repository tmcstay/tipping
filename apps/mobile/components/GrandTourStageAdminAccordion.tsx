import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { GrandTourStageAdminSummary } from "@tipping-suite/supabase-client";

import { formatShortDate } from "../lib/formatters";
import {
  buildAdminStageReviewCountsLabel,
  formatReviewStatusLabel,
  resolveAdminStageDateStatus
} from "../lib/grandtourAdminExperience";
import { GrandTourStageAdminCard } from "./GrandTourStageAdminCard";
import { ui } from "./theme";

/**
 * One collapsed-by-default accordion card per stage on the admin Stage
 * Review screen, matching the same collapse convention already used by
 * GrandTourStageResultAccordion (My Tips) - plain per-card useState(false),
 * a Pressable header with a chevron, body only mounted while expanded.
 * Previously every stage's full review/action panel (GrandTourStageAdminCard)
 * rendered permanently expanded in a flat list, which is what made the
 * screen unusable once more than a handful of stages existed.
 *
 * The header alone must give an admin enough to identify and triage a
 * stage without expanding it: stage number/name/date, whether the stage
 * has actually happened yet (date-based, independent of review_status),
 * the review/reconciliation status, whether the result is final, and an
 * at-a-glance count of reviewed/unresolved result lines and jersey
 * holders. Expanding reveals the exact same GrandTourStageAdminCard as
 * before, unmodified - every reconciliation/import/validation/approval/
 * correction action stays exactly where it was.
 */
export function GrandTourStageAdminAccordion({
  currentUserId,
  grandTourName,
  grandTourYear,
  notificationCountsLine,
  now,
  onActionComplete,
  summary
}: {
  currentUserId: string;
  /** The race's own name/year (e.g. "Tour de France"/2026) - passed straight through to GrandTourStageAdminCard, which sends them to the run-official-check server route as a stage lookup key. Not derived from `summary` (which has no race-level fields), and never the formatted display name (e.g. "Tour de France ’26") - that string must match the raw grand_tours.name row for the lookup to resolve. */
  grandTourName: string;
  grandTourYear: number;
  /** Pre-formatted "pending N, sent N, failed N, skipped N" line, or null if not yet loaded - kept as a caller-supplied string since the notification-counts data layer is unrelated to this component's own concerns. */
  notificationCountsLine: string | null;
  now: Date;
  onActionComplete: () => void;
  summary: GrandTourStageAdminSummary;
}) {
  const [expanded, setExpanded] = useState(false);
  const dateStatus = resolveAdminStageDateStatus(summary.stageDate, now);
  const reviewStatusLabel = formatReviewStatusLabel(summary.reviewStatus);
  const reviewCountsLabel = buildAdminStageReviewCountsLabel(summary);

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityLabel={`Stage ${summary.stageNumber}${expanded ? ", collapse" : ", expand"} — ${reviewStatusLabel}, ${summary.isFinal ? "final" : "not final"}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={() => setExpanded((value) => !value)}
        style={styles.header}
      >
        <View style={styles.headerTopRow}>
          <Text style={styles.stageTitle} numberOfLines={1}>
            Stage {summary.stageNumber}{summary.stageName ? `: ${summary.stageName}` : ""}
          </Text>
          <Text style={styles.chevron}>{expanded ? "▲" : "▼"}</Text>
        </View>
        <Text style={styles.stageDate}>{formatShortDate(summary.stageDate)} · {dateStatus}</Text>
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{reviewStatusLabel}</Text>
          </View>
          <View style={[styles.badge, summary.isFinal ? styles.badgeFinal : styles.badgeNotFinal]}>
            <Text style={[styles.badgeText, summary.isFinal && styles.badgeTextFinal]}>
              {summary.isFinal ? "Final" : "Not final"}
            </Text>
          </View>
        </View>
        <Text style={styles.countsLine}>{reviewCountsLabel}</Text>
        {notificationCountsLine ? <Text style={styles.notificationLine}>{notificationCountsLine}</Text> : null}
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          <GrandTourStageAdminCard
            currentUserId={currentUserId}
            grandTourName={grandTourName}
            grandTourYear={grandTourYear}
            onActionComplete={onActionComplete}
            summary={summary}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: ui.colors.surfaceMuted,
    borderRadius: ui.radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3
  },
  badgeFinal: { backgroundColor: ui.colors.positiveSoft },
  badgeNotFinal: { backgroundColor: ui.colors.surfaceMuted },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  badgeText: { color: ui.colors.muted, fontSize: 11, fontWeight: "800" },
  badgeTextFinal: { color: ui.colors.positiveStrong },
  body: { borderTopColor: ui.colors.border, borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  card: { backgroundColor: ui.colors.surface, borderColor: ui.colors.border, borderRadius: ui.radius.large, borderWidth: 1, padding: 16, ...ui.shadow },
  chevron: { color: ui.colors.primary, fontSize: 14, fontWeight: "900", marginLeft: 8 },
  countsLine: { color: ui.colors.muted, fontSize: 12, fontWeight: "700", marginTop: 6 },
  header: { minHeight: 44 },
  headerTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  notificationLine: { color: ui.colors.faint, fontSize: 11, marginTop: 4 },
  stageDate: { color: ui.colors.muted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  stageTitle: { color: ui.colors.ink, flex: 1, fontSize: 16, fontWeight: "900" }
});
