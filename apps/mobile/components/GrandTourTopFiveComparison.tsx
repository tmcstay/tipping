import { StyleSheet, Text, View } from "react-native";
import type { TopFiveRowDetail } from "../lib/grandtourStageResultsExperience";

import { formatOrdinal } from "../lib/formatters";
import { topFiveMatchTypeToBadgeTone } from "../lib/grandtourStageResultsExperience";
import { SCORE_OUTCOME_BADGE_COLORS } from "./ScoreOutcomeBadge";
import { ui } from "./theme";

// Labels stay specific to this screen's richer, prediction-centric layout
// ("Exact"/"Top 5"/"Miss"/"Not picked" vs. the results screen's compact
// "+N"/"✓"/"–") - only the colours are shared, via
// topFiveMatchTypeToBadgeTone + SCORE_OUTCOME_BADGE_COLORS
// (components/ScoreOutcomeBadge.tsx), so every scored-pick badge in the
// app uses the same green/blue/neutral system. This used to be its own
// separate hardcoded palette that put "top5-wrong-position" in amber and
// "miss" in red - both real inconsistencies with the shared convention,
// not just a different look.
const MATCH_LABELS: Record<TopFiveRowDetail["matchType"], string> = {
  exact: "Exact",
  "top5-wrong-position": "Top 5",
  miss: "Miss",
  "not-picked": "Not picked"
};

/**
 * Requirement #2A's Top 5 comparison table, rendered as stacked two-line
 * rows (not a rigid multi-column grid) so bib/points stay readable and
 * legible without horizontal scrolling on a narrow screen - the same
 * "compact row, no fixed grid" approach already used by the rest of this
 * app's tables (e.g. GrandTourStageAdminCard), just split across two
 * lines per row here since this table has more columns to show.
 *
 * `pending` (tip submitted/locked but not yet scored) hides points/match
 * badges entirely rather than showing a misleading "0 pts" - the finish
 * itself (if the official result already exists) is still shown.
 */
export function GrandTourTopFiveComparison({ pending, rows, subtotal }: { pending: boolean; rows: TopFiveRowDetail[]; subtotal: number | null }) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Top 5 comparison</Text>
      {rows.map((row) => {
        const badgeColors = SCORE_OUTCOME_BADGE_COLORS[topFiveMatchTypeToBadgeTone(row.matchType)];
        const actualFinishLabel = row.predictedRiderId === null
          ? "—"
          : row.actualPosition !== null
            ? formatOrdinal(row.actualPosition)
            : "Not in result";
        return (
          <View key={row.predictedPosition} style={styles.row}>
            <View style={styles.rowTop}>
              <Text style={styles.position}>{row.predictedPosition}</Text>
              <View style={styles.nameColumn}>
                <Text numberOfLines={1} style={styles.riderName}>
                  {row.predictedRiderName ?? "Not picked"}
                </Text>
                {row.predictedRiderId ? (
                  <Text numberOfLines={1} style={styles.subtext}>
                    {row.predictedBibNumber !== null ? `#${row.predictedBibNumber}` : ""}
                    {row.predictedBibNumber !== null && row.predictedTeamName ? " · " : ""}
                    {row.predictedTeamName ?? ""}
                  </Text>
                ) : null}
              </View>
              {!pending ? (
                <Text style={styles.points}>{row.points !== null ? `${row.points >= 0 ? "+" : ""}${row.points} pts` : ""}</Text>
              ) : null}
            </View>
            <View style={styles.rowBottom}>
              <Text numberOfLines={1} style={styles.detailText}>
                Actual finish: <Text style={styles.detailValue}>{actualFinishLabel}</Text>
                {"  ·  "}Official {row.predictedPosition}{formatOrdinalSuffix(row.predictedPosition)}: <Text style={styles.detailValue}>{row.officialRiderName ?? "Not available"}</Text>
              </Text>
              {!pending && row.predictedRiderId ? (
                <View style={[styles.badge, { backgroundColor: badgeColors.backgroundColor }]}>
                  <Text style={[styles.badgeText, { color: badgeColors.color }]}>{MATCH_LABELS[row.matchType]}</Text>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
      {pending ? (
        <Text style={styles.pendingNote}>Awaiting official scoring.</Text>
      ) : (
        <View style={styles.subtotalRow}>
          <Text style={styles.subtotalLabel}>Top 5 points</Text>
          <Text style={styles.subtotalValue}>{subtotal ?? 0}</Text>
        </View>
      )}
    </View>
  );
}

function formatOrdinalSuffix(value: number) {
  return formatOrdinal(value).replace(String(value), "");
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", borderRadius: ui.radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  container: { gap: 8 },
  detailText: { color: ui.colors.muted, flex: 1, fontSize: 11, fontWeight: "700" },
  detailValue: { color: ui.colors.ink, fontWeight: "900" },
  heading: { color: ui.colors.ink, fontSize: 13, fontWeight: "900" },
  nameColumn: { flex: 1 },
  pendingNote: { color: ui.colors.warning, fontSize: 12, fontStyle: "italic", fontWeight: "700" },
  points: { color: ui.colors.primary, fontSize: 13, fontWeight: "900", minWidth: 56, textAlign: "right" },
  position: { color: ui.colors.muted, fontSize: 13, fontWeight: "900", width: 20 },
  riderName: { color: ui.colors.ink, fontSize: 13, fontWeight: "900" },
  row: { borderBottomColor: ui.colors.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: 3, paddingVertical: 6 },
  rowBottom: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between", paddingLeft: 20 },
  rowTop: { alignItems: "center", flexDirection: "row", gap: 8 },
  subtext: { color: ui.colors.muted, fontSize: 11, fontWeight: "700", marginTop: 1 },
  subtotalLabel: { color: ui.colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  subtotalRow: { alignItems: "center", borderTopColor: ui.colors.border, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 4, paddingTop: 8 },
  subtotalValue: { color: ui.colors.primary, fontSize: 16, fontWeight: "900" }
});
