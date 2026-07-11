import { StyleSheet, Text, View } from "react-native";
import type { GrandTourHistorySummary } from "../lib/grandtourHistoryExperience";

import { InfoCard } from "./InfoCard";

/** Requirement #3: cumulative totals shown above the stage history list. */
export function GrandTourResultsSummary({ summary }: { summary: GrandTourHistorySummary }) {
  return (
    <InfoCard accent meta={`${summary.scoredStages} stage${summary.scoredStages === 1 ? "" : "s"} scored`} title={`${summary.totalScore} points`}>
      <View style={styles.grid}>
        <Stat label="Top 5 points" value={summary.totalTop5} />
        <Stat label="Jersey points" value={summary.totalJersey} />
        <Stat label="Bonus points" value={summary.totalBonus} />
        <Stat label="Best stage" value={summary.bestStageScore ?? "—"} />
        <Stat
          label="Average / stage"
          value={summary.averageScore !== null ? summary.averageScore.toFixed(1) : "—"}
        />
      </View>
    </InfoCard>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14
  },
  stat: {
    minWidth: "28%"
  },
  statLabel: {
    color: "#CFE4D8",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
    textTransform: "uppercase"
  },
  statValue: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900"
  }
});
