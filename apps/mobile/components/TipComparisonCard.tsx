import { StyleSheet, Text, View } from "react-native";
import type { LeagueTipComparison } from "@tipping-suite/supabase-client";

import { InfoCard } from "./InfoCard";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { TipStatusBadge } from "./TipStatusBadge";

export function TipComparisonCard({ tip, riderName }: {
  tip: LeagueTipComparison;
  riderName: (id: string) => string;
}) {
  const topFive = tip.selections
    .filter((selection) => selection.selection_type === "stage_top_5")
    .sort((a, b) => (a.predicted_position ?? 0) - (b.predicted_position ?? 0));
  const jerseys = tip.selections.filter((selection) => selection.selection_type !== "stage_top_5");
  return (
    <InfoCard title={tip.display_name} meta={tip.is_dummy ? "Dummy user · not prize eligible" : "League member"}>
      <TipStatusBadge status={tip.status} />
      {topFive.length ? (
        <View style={styles.section}>
          <Text style={styles.heading}>Ordered Top 5</Text>
          {topFive.map((selection) => (
            <Text key={selection.id} style={styles.copy}>{selection.predicted_position}. {riderName(selection.rider_id)}</Text>
          ))}
        </View>
      ) : null}
      <View style={styles.section}>
        <Text style={styles.heading}>Jerseys</Text>
        {jerseys.map((selection) => (
          <Text key={selection.id} style={styles.copy}>
            {selection.selection_type.replace("overall_", "").replace("_holder", "").replace("_winner", "").replaceAll("_", " ")}: {riderName(selection.rider_id)}
          </Text>
        ))}
      </View>
      {tip.score ? <ScoreBreakdown score={tip.score} /> : null}
    </InfoCard>
  );
}

const styles = StyleSheet.create({
  copy: { color: "#536159", fontSize: 14, textTransform: "capitalize" },
  heading: { color: "#17231C", fontSize: 14, fontWeight: "900" },
  section: { gap: 4, marginTop: 4 }
});
