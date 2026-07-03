import { StyleSheet, Text, View } from "react-native";
import type { GrandTourScore } from "@tipping-suite/supabase-client";

export function ScoreBreakdown({ score }: { score: GrandTourScore }) {
  const details = typeof score.score_details === "object"
    && score.score_details !== null
    && !Array.isArray(score.score_details)
    ? score.score_details
    : {};
  const isTeamResult = details.stage_result_type === "team";
  const teamStageScore = typeof details.team_stage_score === "number"
    ? details.team_stage_score
    : score.top5_score + score.bonus_score;
  const jerseyPending = details.jersey_pending === true;

  return (
    <View style={styles.box}>
      <Text style={styles.total}>{score.total_score} points</Text>
      {isTeamResult ? (
        <>
          <View style={styles.row}><Text style={styles.label}>Team stage points</Text><Text style={styles.value}>{teamStageScore}</Text></View>
          <View style={styles.subRow}><Text style={styles.subLabel}>Team Top 5</Text><Text style={styles.subValue}>{score.top5_score}</Text></View>
          <View style={styles.subRow}><Text style={styles.subLabel}>Winning team bonus</Text><Text style={styles.subValue}>{score.bonus_score}</Text></View>
          <View style={styles.row}>
            <Text style={styles.label}>Jersey points</Text>
            <Text style={jerseyPending ? styles.pendingValue : styles.value}>{jerseyPending ? "Pending" : score.jersey_score}</Text>
          </View>
          {jerseyPending ? <Text style={styles.pending}>Jersey scoring will update when official individual jersey holders are available.</Text> : null}
        </>
      ) : (
        <>
          <View style={styles.row}><Text style={styles.label}>Ordered Top 5</Text><Text style={styles.value}>{score.top5_score}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Jerseys</Text><Text style={styles.value}>{score.jersey_score}</Text></View>
          {score.bonus_score ? <View style={styles.row}><Text style={styles.label}>Adjustment</Text><Text style={styles.value}>{score.bonus_score}</Text></View> : null}
        </>
      )}
      {!score.is_prize_eligible ? <Text style={styles.dummy}>Dummy entry — not prize eligible</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: "#F3F7F4", borderRadius: 10, gap: 6, padding: 12 },
  dummy: { color: "#8A5A00", fontSize: 12, fontWeight: "800", marginTop: 4 },
  label: { color: "#536159", fontSize: 14 },
  pending: { color: "#8A5A00", fontSize: 12, fontWeight: "700", lineHeight: 17 },
  pendingValue: { color: "#8A5A00", fontSize: 14, fontWeight: "900" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  subLabel: { color: "#68746D", fontSize: 12 },
  subRow: { flexDirection: "row", justifyContent: "space-between", paddingLeft: 10 },
  subValue: { color: "#536159", fontSize: 12, fontWeight: "800" },
  total: { color: "#12372A", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  value: { color: "#17231C", fontSize: 14, fontWeight: "900" }
});
