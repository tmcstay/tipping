import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ui } from "./theme";

export type JerseyKind = "yellow" | "green" | "kom" | "white";

const presentation: Record<JerseyKind, { label: string; color: string; text: string }> = {
  yellow: { label: "Yellow", color: "#F2D43D", text: "#322B00" },
  green: { label: "Green", color: "#299447", text: "#FFFFFF" },
  kom: { label: "Polka Dot", color: "#FFF4F3", text: "#C63E37" },
  white: { label: "White", color: "#FFFFFF", text: ui.colors.ink }
};

export function JerseyHolderCard({ jersey, riderName, teamName, href, accessibilityHint }: {
  jersey: JerseyKind;
  riderName?: string | null;
  teamName?: string | null;
  href?: string;
  accessibilityHint?: string;
}) {
  const style = presentation[jersey];
  const content = (
    <>
      <View style={styles.headerRow}>
        <View style={[styles.jersey, { backgroundColor: style.color }]}>
          <Text style={[styles.jerseyText, { color: style.text }]}>{jersey === "kom" ? "••" : style.label.slice(0, 1)}</Text>
        </View>
        {href ? <Text style={styles.chevron} accessibilityElementsHidden>›</Text> : null}
      </View>
      <Text style={styles.label}>{style.label}</Text>
      <Text numberOfLines={2} style={riderName ? styles.rider : styles.pending}>{riderName ?? "Pending"}</Text>
      {teamName ? <Text numberOfLines={1} style={styles.team}>{teamName}</Text> : null}
    </>
  );

  if (!href) {
    return <View style={styles.card}>{content}</View>;
  }

  const pressable = (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={`${style.label} jersey, ${riderName ?? "pending"}${teamName ? `, ${teamName}` : ""}`}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
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
  card: { backgroundColor: ui.colors.surfaceMuted, borderColor: ui.colors.border, borderRadius: ui.radius.medium, borderWidth: 1, flexBasis: "47%", flexGrow: 1, minHeight: 142, padding: 12 },
  cardPressed: { opacity: 0.85 },
  chevron: { color: ui.colors.muted, fontSize: 16, fontWeight: "900" },
  headerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  jersey: { alignItems: "center", borderColor: ui.colors.border, borderRadius: 9, borderWidth: 1, height: 38, justifyContent: "center", width: 31 },
  jerseyText: { fontSize: 13, fontWeight: "900", letterSpacing: -1 },
  label: { color: ui.colors.muted, fontSize: 11, fontWeight: "900", marginTop: 9, textTransform: "uppercase" },
  pending: { color: ui.colors.muted, fontSize: 14, fontWeight: "800", marginTop: 4 },
  rider: { color: ui.colors.ink, fontSize: 14, fontWeight: "900", lineHeight: 18, marginTop: 4 },
  team: { color: ui.colors.muted, fontSize: 11, marginTop: 3 }
});
