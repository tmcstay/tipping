import { StyleSheet, Text, View } from "react-native";

import { ui } from "./theme";

export type StageStatusTone = "open" | "closing_soon" | "closed" | "live" | "provisional" | "completed";

export type StageStatusBadgeProps = {
  tone: StageStatusTone;
  label: string;
  /** High-emphasis rendering (e.g. <60m-remaining closing_soon, or live) - stronger colour + bold border. */
  emphasis?: boolean;
};

const TONE_STYLES: Record<StageStatusTone, { background: string; text: string; border?: string }> = {
  open: { background: ui.colors.primarySoft, text: ui.colors.primary },
  closing_soon: { background: ui.colors.warningSoft, text: ui.colors.warning },
  closed: { background: ui.colors.surfaceMuted, text: ui.colors.muted, border: ui.colors.border },
  live: { background: ui.colors.danger, text: "#FFFFFF" },
  provisional: { background: ui.colors.tttSoft, text: ui.colors.ttt },
  completed: { background: ui.colors.primary, text: "#FFFFFF" }
};

/** Compact status pill used across the dashboard: Open / Closing soon / Closed / Live / Provisional / Completed. */
export function StageStatusBadge({ emphasis, label, tone }: StageStatusBadgeProps) {
  const toneStyle = TONE_STYLES[tone];
  return (
    <View
      accessibilityElementsHidden
      style={[
        styles.badge,
        { backgroundColor: toneStyle.background },
        toneStyle.border ? { borderColor: toneStyle.border, borderWidth: 1 } : null,
        emphasis && styles.emphasis
      ]}
    >
      {tone === "closed" ? <Text style={[styles.lockIcon, { color: toneStyle.text }]}>🔒</Text> : null}
      <Text style={[styles.text, { color: toneStyle.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: ui.radius.pill,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  emphasis: {
    borderColor: ui.colors.danger,
    borderWidth: 1.5
  },
  lockIcon: {
    fontSize: 10
  },
  text: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
  }
});
