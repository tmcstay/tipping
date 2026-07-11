import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  EXACT_POSITION_POINTS,
  STAGE_JERSEY_POINTS,
  TOP_FIVE_WRONG_POSITION_POINTS
} from "@tipping-suite/tipping-core";

import { buildScoreExplanationLines } from "../lib/grandtourStageResultsExperience";
import { ui } from "./theme";

/**
 * Requirement #2E: a nested collapsible "How this score was calculated"
 * section, defaulting closed. The actual point values come from
 * @tipping-suite/tipping-core's exported scoring constants (the same
 * values public.recalculate_grandtour_stage_scores uses server-side) via
 * buildScoreExplanationLines - never separately hard-coded here.
 */
export function GrandTourScoreExplanation() {
  const [expanded, setExpanded] = useState(false);
  const lines = buildScoreExplanationLines({
    exactPositionPoints: EXACT_POSITION_POINTS,
    topFiveWrongPositionPoints: TOP_FIVE_WRONG_POSITION_POINTS,
    stageJerseyPoints: STAGE_JERSEY_POINTS
  });

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel={expanded ? "Hide how this score was calculated" : "Show how this score was calculated"}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        hitSlop={8}
        onPress={() => setExpanded((value) => !value)}
        style={styles.toggle}
      >
        <Text style={styles.toggleText}>How this score was calculated</Text>
        <Text style={styles.chevron}>{expanded ? "▲" : "▼"}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.box}>
          {lines.map((line) => (
            <Text key={line} style={styles.line}>• {line}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: ui.colors.surfaceMuted, borderRadius: ui.radius.small, gap: 4, marginTop: 8, padding: 10 },
  chevron: { color: ui.colors.primary, fontSize: 12, fontWeight: "900" },
  container: { marginTop: 10 },
  line: { color: ui.colors.muted, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  toggle: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between", minHeight: 40 },
  toggleText: { color: ui.colors.primary, fontSize: 13, fontWeight: "900" }
});
