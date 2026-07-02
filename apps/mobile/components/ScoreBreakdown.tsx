import { StyleSheet, Text, View } from "react-native";
import type { GrandTourScore } from "@tipping-suite/supabase-client";

export function ScoreBreakdown({ score }: { score: GrandTourScore }) {
  return (
    <View style={styles.box}>
      <Text style={styles.total}>{score.total_score} points</Text>
      <View style={styles.row}><Text style={styles.label}>Ordered Top 5</Text><Text style={styles.value}>{score.top5_score}</Text></View>
      <View style={styles.row}><Text style={styles.label}>Jerseys</Text><Text style={styles.value}>{score.jersey_score}</Text></View>
      {score.bonus_score ? <View style={styles.row}><Text style={styles.label}>Adjustment</Text><Text style={styles.value}>{score.bonus_score}</Text></View> : null}
      {!score.is_prize_eligible ? <Text style={styles.dummy}>Dummy entry — not prize eligible</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: "#F3F7F4", borderRadius: 10, gap: 6, padding: 12 },
  dummy: { color: "#8A5A00", fontSize: 12, fontWeight: "800", marginTop: 4 },
  label: { color: "#536159", fontSize: 14 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  total: { color: "#12372A", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  value: { color: "#17231C", fontSize: 14, fontWeight: "900" }
});
