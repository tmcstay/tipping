import { StyleSheet, Text, View } from "react-native";
import type { JerseyComparisonRow, TopFiveComparisonRow } from "../lib/grandtourHistoryExperience";

import { ui } from "./theme";

const TOP_FIVE_STYLE: Record<TopFiveComparisonRow["matchType"], { label: string; badgeStyle: object; textStyle: object }> = {
  exact: { label: "Exact", badgeStyle: { backgroundColor: "#D7F0DE" }, textStyle: { color: "#176B3A" } },
  "top5-wrong-position": { label: "Top 5, wrong spot", badgeStyle: { backgroundColor: "#FFF3CD" }, textStyle: { color: "#8A5A00" } },
  "outside-top-5": { label: "Outside top 5", badgeStyle: { backgroundColor: "#F6D8D6" }, textStyle: { color: "#A12622" } },
  "not-picked": { label: "Not picked", badgeStyle: { backgroundColor: ui.colors.border }, textStyle: { color: ui.colors.muted } }
};

const JERSEY_STYLE: Record<JerseyComparisonRow["matchType"], { label: string; badgeStyle: object; textStyle: object }> = {
  match: { label: "Match", badgeStyle: { backgroundColor: "#D7F0DE" }, textStyle: { color: "#176B3A" } },
  miss: { label: "Miss", badgeStyle: { backgroundColor: "#F6D8D6" }, textStyle: { color: "#A12622" } },
  "not-picked": { label: "Not picked", badgeStyle: { backgroundColor: ui.colors.border }, textStyle: { color: ui.colors.muted } },
  pending: { label: "Pending", badgeStyle: { backgroundColor: "#FFF3CD" }, textStyle: { color: "#8A5A00" } }
};

const JERSEY_LABELS: Record<string, string> = {
  yellow: "Yellow",
  green: "Green",
  kom: "KOM",
  white: "White"
};

export function StageResultComparison({
  topFive,
  jerseys,
  itemName
}: {
  topFive: TopFiveComparisonRow[];
  jerseys: JerseyComparisonRow[];
  itemName: (id: string) => string;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Your Top 5 vs official result</Text>
      {topFive.map((row) => {
        const presentation = TOP_FIVE_STYLE[row.matchType];
        return (
          <View key={row.predictedPosition} style={styles.row}>
            <Text style={styles.position}>{row.predictedPosition}.</Text>
            <Text style={styles.name} numberOfLines={1}>
              {row.predictedRiderId ? itemName(row.predictedRiderId) : "Not picked"}
            </Text>
            <Text style={styles.actual}>
              {row.actualPosition !== null ? `Finished ${row.actualPosition}` : ""}
            </Text>
            <View style={[styles.badge, presentation.badgeStyle]}>
              <Text style={[styles.badgeText, presentation.textStyle]}>{presentation.label}</Text>
            </View>
          </View>
        );
      })}

      <Text style={styles.heading}>Your jersey picks vs official holders</Text>
      {jerseys.map((row) => {
        const presentation = JERSEY_STYLE[row.matchType];
        return (
          <View key={row.jerseyType} style={styles.row}>
            <Text style={styles.jerseyLabel}>{JERSEY_LABELS[row.jerseyType]}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {row.predictedRiderId ? itemName(row.predictedRiderId) : "Not picked"}
            </Text>
            <Text style={styles.actual}>
              {row.actualRiderId ? itemName(row.actualRiderId) : ""}
            </Text>
            <View style={[styles.badge, presentation.badgeStyle]}>
              <Text style={[styles.badgeText, presentation.textStyle]}>{presentation.label}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  actual: {
    color: ui.colors.muted,
    fontSize: 11,
    fontWeight: "700",
    minWidth: 66
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  container: {
    gap: 6,
    marginTop: 10
  },
  heading: {
    color: ui.colors.ink,
    fontSize: 13,
    fontWeight: "900",
    marginTop: 10
  },
  jerseyLabel: {
    color: ui.colors.ink,
    fontSize: 12,
    fontWeight: "800",
    width: 48
  },
  name: {
    color: ui.colors.ink,
    flex: 1,
    fontSize: 12,
    fontWeight: "700"
  },
  position: {
    color: ui.colors.muted,
    fontSize: 12,
    fontWeight: "900",
    width: 18
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    paddingVertical: 4
  }
});
