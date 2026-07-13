import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ui } from "./theme";

export type JerseyKind = "yellow" | "green" | "kom" | "white";

/**
 * Jersey colours are real, canonical information (the actual competition
 * result), not decorative UI chrome - kept, but reduced to a small dot
 * rather than a large coloured card, so they read as a label rather than a
 * block of colour.
 */
const presentation: Record<JerseyKind, { label: string; dot: string; dotBorder?: string }> = {
  yellow: { label: "Yellow", dot: "#F2D43D" },
  green: { label: "Green", dot: "#299447" },
  kom: { label: "Polka dot", dot: "#FFFFFF", dotBorder: "#C63E37" },
  white: { label: "White", dot: "#FFFFFF", dotBorder: ui.colors.border }
};

/** A single compact row - "● Yellow  Rider Name  Team" - not a coloured card. */
export function JerseyHolderCard({ jersey, riderName, teamName, href, accessibilityHint }: {
  jersey: JerseyKind;
  riderName?: string | null;
  teamName?: string | null;
  href?: string;
  accessibilityHint?: string;
}) {
  const style = presentation[jersey];
  // The flex-row layout lives on this inner View, never on the
  // Pressable/Link root itself - when a Pressable is cloned by expo-router's
  // <Link asChild> on web it can render as a real <a>, which does not
  // reliably inherit React Native Web's implicit `display: flex` the way a
  // plain View/Pressable does. Confirmed with a real browser: putting
  // flexDirection directly on the Link-wrapped Pressable's style collapsed
  // this row to stacked/vertical layout instead of the intended single line.
  const content = (
    <View style={styles.rowInner}>
      <View style={[styles.dot, { backgroundColor: style.dot }, style.dotBorder ? { borderColor: style.dotBorder, borderWidth: 1 } : null]} />
      <Text style={styles.label}>{style.label}</Text>
      <View style={styles.riderColumn}>
        <Text numberOfLines={1} style={riderName ? styles.rider : styles.pending}>{riderName ?? "Pending"}</Text>
        {teamName ? <Text numberOfLines={1} style={styles.team}>{teamName}</Text> : null}
      </View>
      {href ? <Text style={styles.chevron} accessibilityElementsHidden>›</Text> : null}
    </View>
  );

  if (!href) {
    return <View style={styles.row}>{content}</View>;
  }

  const pressable = (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={`${style.label} jersey, ${riderName ?? "pending"}${teamName ? `, ${teamName}` : ""}`}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {content}
    </Pressable>
  );

  return (
    <Link asChild href={href}>
      {pressable}
    </Link>
  );
}

const styles = StyleSheet.create({
  chevron: { color: ui.colors.faint, fontSize: 16, fontWeight: "600" },
  dot: { borderRadius: 6, height: 12, width: 12 },
  label: { color: ui.colors.muted, fontSize: 12, fontWeight: "600", width: 66 },
  pending: { color: ui.colors.faint, fontSize: 13, fontWeight: "500" },
  rider: { color: ui.colors.ink, fontSize: 13, fontWeight: "600" },
  riderColumn: { flex: 1 },
  row: { justifyContent: "center", minHeight: 38 },
  rowInner: { alignItems: "center", flexDirection: "row", gap: 10 },
  rowPressed: { opacity: 0.6 },
  team: { color: ui.colors.faint, fontSize: 11, marginTop: 1 }
});
