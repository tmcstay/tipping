import { StyleSheet, Text, View } from "react-native";
import type { JerseyRowDetail } from "../lib/grandtourStageResultsExperience";

import { jerseyMatchTypeToBadgeTone } from "../lib/grandtourStageResultsExperience";
import { SCORE_OUTCOME_BADGE_COLORS } from "./ScoreOutcomeBadge";
import { ui } from "./theme";

const JERSEY_LABELS: Record<JerseyRowDetail["jerseyType"], string> = {
  yellow: "Yellow (GC)",
  green: "Green (Points)",
  kom: "KOM (Climber)",
  white: "White (Youth)"
};

const JERSEY_DOT_COLOR: Record<JerseyRowDetail["jerseyType"], string> = {
  yellow: "#F4C430",
  green: "#3E9B4F",
  kom: "#C0392B",
  white: "#FFFFFF"
};

// Labels stay specific to this screen; only the colours come from the
// shared tone system (jerseyMatchTypeToBadgeTone + SCORE_OUTCOME_BADGE_COLORS,
// components/ScoreOutcomeBadge.tsx) - this used to hardcode its own red
// for "miss", which conflicted with this app's convention that red is
// reserved for genuine errors, never a scoring outcome.
const MATCH_LABELS: Record<JerseyRowDetail["matchType"], string> = {
  match: "Match",
  miss: "Miss",
  "not-picked": "Not picked",
  pending: "Pending"
};

/** Requirement #2B's jersey comparison table/cards. */
export function GrandTourJerseyComparison({ rows, subtotal }: { rows: JerseyRowDetail[]; subtotal: number | null }) {
  const allNotPicked = rows.every((row) => row.matchType === "not-picked");

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Jersey comparison</Text>
      {allNotPicked ? (
        <Text style={styles.emptyCopy}>No jersey picks</Text>
      ) : (
        <>
          {rows.map((row) => {
            const badgeColors = SCORE_OUTCOME_BADGE_COLORS[jerseyMatchTypeToBadgeTone(row.matchType)];
            return (
              <View key={row.jerseyType} style={styles.row}>
                <View style={[styles.dot, { backgroundColor: JERSEY_DOT_COLOR[row.jerseyType] }, row.jerseyType === "white" && styles.dotOutline]} />
                <View style={styles.nameColumn}>
                  <Text style={styles.jerseyLabel}>{JERSEY_LABELS[row.jerseyType]}</Text>
                  <Text numberOfLines={1} style={styles.subtext}>
                    My pick: <Text style={styles.detailValue}>{row.predictedRiderName ?? "Not picked"}</Text>
                    {"  ·  "}Actual: <Text style={styles.detailValue}>{row.actualRiderName ?? "Not available"}</Text>
                  </Text>
                </View>
                <View style={styles.endColumn}>
                  {row.matchType !== "not-picked" ? (
                    <Text style={styles.points}>{row.points !== null ? `+${row.points} pts` : ""}</Text>
                  ) : null}
                  <View style={[styles.badge, { backgroundColor: badgeColors.backgroundColor }]}>
                    <Text style={[styles.badgeText, { color: badgeColors.color }]}>{MATCH_LABELS[row.matchType]}</Text>
                  </View>
                </View>
              </View>
            );
          })}
          <View style={styles.subtotalRow}>
            <Text style={styles.subtotalLabel}>Jersey points</Text>
            <Text style={styles.subtotalValue}>{subtotal ?? "Pending"}</Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-end", borderRadius: ui.radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  container: { gap: 8 },
  detailValue: { color: ui.colors.ink, fontWeight: "900" },
  dot: { borderRadius: 999, height: 14, width: 14 },
  dotOutline: { borderColor: ui.colors.border, borderWidth: 1 },
  emptyCopy: { color: ui.colors.muted, fontSize: 13, fontStyle: "italic" },
  endColumn: { alignItems: "flex-end", gap: 3 },
  heading: { color: ui.colors.ink, fontSize: 13, fontWeight: "900" },
  jerseyLabel: { color: ui.colors.ink, fontSize: 13, fontWeight: "900" },
  nameColumn: { flex: 1, gap: 2 },
  points: { color: ui.colors.primary, fontSize: 12, fontWeight: "900" },
  row: { alignItems: "center", borderBottomColor: ui.colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 8, paddingVertical: 6 },
  subtext: { color: ui.colors.muted, fontSize: 11, fontWeight: "700" },
  subtotalLabel: { color: ui.colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  subtotalRow: { alignItems: "center", borderTopColor: ui.colors.border, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 4, paddingTop: 8 },
  subtotalValue: { color: ui.colors.primary, fontSize: 16, fontWeight: "900" }
});
