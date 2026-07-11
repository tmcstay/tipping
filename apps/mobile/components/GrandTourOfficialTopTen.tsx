import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { OfficialResultRiderRow } from "../lib/grandtourStageResultsExperience";

import { ui } from "./theme";

/**
 * Requirement #2D: a nested collapsible "Official Top 10" section inside
 * each expanded stage item. Defaults closed - the primary view when a
 * stage is expanded is the user's picks/score, not the full official
 * result, so this stays tucked away until explicitly opened.
 */
export function GrandTourOfficialTopTen({ rows }: { rows: OfficialResultRiderRow[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel={expanded ? "Hide official top 10" : "Show official top 10"}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        hitSlop={8}
        onPress={() => setExpanded((value) => !value)}
        style={styles.toggle}
      >
        <Text style={styles.toggleText}>Official Top 10</Text>
        <Text style={styles.chevron}>{expanded ? "▲" : "▼"}</Text>
      </Pressable>

      {expanded ? (
        rows.length === 0 ? (
          <Text style={styles.emptyCopy}>No official result is available for this stage yet.</Text>
        ) : (
          <View style={styles.table}>
            {rows.map((row) => (
              <View key={row.riderId} style={styles.row}>
                <Text style={styles.position}>{row.position}</Text>
                <Text style={styles.bib}>{row.bibNumber !== null ? `#${row.bibNumber}` : "—"}</Text>
                <Text numberOfLines={1} style={styles.name}>{row.riderName}</Text>
                <Text numberOfLines={1} style={styles.team}>{row.teamName ?? "—"}</Text>
              </View>
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bib: { color: ui.colors.muted, fontSize: 11, fontWeight: "800", width: 40 },
  chevron: { color: ui.colors.primary, fontSize: 12, fontWeight: "900" },
  container: { marginTop: 10 },
  emptyCopy: { color: ui.colors.muted, fontSize: 12, fontStyle: "italic", marginTop: 6 },
  name: { color: ui.colors.ink, flex: 1, fontSize: 12, fontWeight: "800" },
  position: { color: ui.colors.ink, fontSize: 12, fontWeight: "900", width: 22 },
  row: { alignItems: "center", borderBottomColor: ui.colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 8, minHeight: 34, paddingVertical: 4 },
  table: { backgroundColor: ui.colors.surfaceMuted, borderRadius: ui.radius.small, marginTop: 8, overflow: "hidden", paddingHorizontal: 8 },
  team: { color: ui.colors.muted, fontSize: 11, fontWeight: "700", width: 90 },
  toggle: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between", minHeight: 40 },
  toggleText: { color: ui.colors.primary, fontSize: 13, fontWeight: "900" }
});
