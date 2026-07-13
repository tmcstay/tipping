import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ui } from "./theme";

type Props = {
  label: string;
  value: string;
  helper?: string;
  href?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

export function DashboardStatCard({ accessibilityHint, accessibilityLabel, helper, href, label, value }: Props) {
  const content = (
    <>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{label}</Text>
        {href ? <Text style={styles.chevron} accessibilityElementsHidden>›</Text> : null}
      </View>
      <Text style={styles.value}>{value}</Text>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </>
  );

  if (!href) {
    return <View style={styles.card}>{content}</View>;
  }

  const pressable = (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`}
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
  card: {
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.large,
    borderWidth: 1,
    flex: 1,
    minHeight: 96,
    minWidth: 136,
    padding: 14
  },
  cardPressed: { opacity: 0.85 },
  chevron: { color: ui.colors.muted, fontSize: 18, fontWeight: "900" },
  headerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  helper: { color: ui.colors.muted, fontSize: 12, fontWeight: "700", marginTop: 4 },
  label: { color: ui.colors.muted, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  value: { color: ui.colors.primary, fontSize: 24, fontWeight: "900", marginTop: 4 }
});
