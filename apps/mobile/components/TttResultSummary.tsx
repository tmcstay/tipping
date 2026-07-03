import { StyleSheet, Text, View } from "react-native";
import type { CyclingStageResult, GrandTourScore } from "@tipping-suite/supabase-client";

import { TTT_RESULT_COPY, TTT_RESULT_SECTIONS } from "../lib/stageExperience";

type JsonObject = Record<string, unknown>;

const jerseyLabels: Record<string, string> = {
  yellow: "Yellow — official individual post-stage holder",
  green: "Green jersey holder",
  kom: "KOM / polka-dot jersey holder",
  white: "White jersey holder"
};

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

export function TttResultSummary({ result, score }: {
  result: CyclingStageResult | null;
  score: GrandTourScore;
}) {
  const details = asObject(score.score_details) ?? {};
  const teamPending = details.team_result_pending === true;
  const jerseyPending = details.jersey_pending === true;

  return (
    <View style={styles.container}>
      <Text style={styles.explainer}>
        {TTT_RESULT_COPY}
      </Text>

      <View style={styles.section}>
        <Text style={styles.heading}>{TTT_RESULT_SECTIONS[0]}</Text>
        <Text style={styles.context}>The winning team determines the stage result, not the yellow jersey holder.</Text>
        {teamPending ? <Text style={styles.pending}>Official team result pending.</Text> : null}
        {!teamPending && !result?.teamResults.length ? <Text style={styles.pending}>No official team result is available yet.</Text> : null}
        {result?.teamResults.map((line) => line.actual_position === 1 ? (
          <View key={line.team.id} style={styles.highlight}>
            <Text style={styles.highlightLabel}>Winning team</Text>
            <Text style={styles.highlightValue}>{line.team.name}</Text>
          </View>
        ) : (
          <Text key={line.team.id} style={styles.resultLine}>
            {line.actual_position}. {line.team.name}
          </Text>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>{TTT_RESULT_SECTIONS[1]}</Text>
        <Text style={styles.context}>Jerseys are always awarded to official individual riders.</Text>
        {jerseyPending ? <Text style={styles.pending}>One or more official jersey results are pending.</Text> : null}
        {result?.jerseyResults.map((line) => (
          <View key={line.jersey_type} style={[styles.jerseyLine, line.jersey_type === "yellow" && styles.highlight]}>
            <Text style={styles.jerseyLabel}>{jerseyLabels[line.jersey_type]}</Text>
            <Text style={styles.rider}>{line.rider.display_name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  context: { color: "#68746D", fontSize: 12, lineHeight: 18 },
  explainer: { backgroundColor: "#EAF2ED", borderRadius: 10, color: "#294A39", fontSize: 14, lineHeight: 20, padding: 12 },
  heading: { color: "#17231C", fontSize: 16, fontWeight: "900" },
  highlight: { backgroundColor: "#FFF8D6", borderRadius: 8, padding: 10 },
  highlightLabel: { color: "#6F5200", fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  highlightValue: { color: "#17231C", fontSize: 15, fontWeight: "900", marginTop: 2 },
  jerseyLabel: { color: "#536159", flex: 1, fontSize: 13 },
  jerseyLine: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  pending: { color: "#8A5A00", fontSize: 13, fontWeight: "700" },
  resultLine: { color: "#17231C", fontSize: 14, fontWeight: "700" },
  rider: { color: "#12372A", fontSize: 13, fontWeight: "800", textAlign: "right" },
  section: { backgroundColor: "#FFFFFF", borderColor: "#D8DED9", borderRadius: 10, borderWidth: 1, gap: 6, padding: 12 }
});
