import { StyleSheet, Text, View } from "react-native";
import type { LeagueTipComparison } from "@tipping-suite/supabase-client";

import { InfoCard } from "./InfoCard";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { TipStatusBadge } from "./TipStatusBadge";

export function TipComparisonCard({ isTtt = false, tip, riderName, teamName }: {
  isTtt?: boolean;
  tip: LeagueTipComparison;
  riderName: (id: string) => string;
  teamName?: (id: string) => string;
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
          <Text style={styles.heading}>{isTtt ? "Team Time Trial Top 5" : "Ordered Top 5"}</Text>
          {topFive.map((selection) => (
            <Text key={selection.id} style={styles.copy}>
              {selection.predicted_position}. {isTtt && selection.team_id
                ? teamName?.(selection.team_id) ?? "Unknown team"
                : selection.rider_id
                  ? riderName(selection.rider_id)
                  : "Unknown rider"}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={styles.section}>
        <Text style={styles.heading}>Jerseys</Text>
        {jerseys.map((selection) => (
          <Text key={selection.id} style={styles.copy}>
            {selection.selection_type.replace("overall_", "").replace("_holder", "").replace("_winner", "").replaceAll("_", " ")}: {selection.rider_id ? riderName(selection.rider_id) : "Pending"}
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
