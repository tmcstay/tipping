import { StyleSheet, Text, View } from "react-native";

import { ui } from "./theme";

export type StageStatusTone = "open" | "closing_soon" | "closed" | "live" | "provisional" | "completed";

export type StageStatusBadgeProps = {
  /** Kept for callers that still track a semantic tone (e.g. for their own accessibility copy) - no longer drives this badge's colour, which is intentionally uniform. See the component doc comment. */
  tone?: StageStatusTone;
  label: string;
  /** High-emphasis rendering (e.g. <60m-remaining closing_soon, or live) - the one place this badge uses the accent colour instead of neutral ink. */
  emphasis?: boolean;
};

/**
 * One neutral chip style for every status - the previous version gave each
 * tone its own background tint (a warm amber, a purple, a red, a full
 * green fill), which read as decorative colour-coding rather than
 * information. Now every badge is the same quiet neutral pill; only
 * `emphasis` (a stage that's live, or closing within the hour) swaps in
 * the single accent colour, so it still stands out without adding another
 * hue to the palette.
 */
export function StageStatusBadge({ emphasis, label }: StageStatusBadgeProps) {
  return (
    <View
      accessibilityElementsHidden
      style={[styles.badge, emphasis && styles.badgeEmphasis]}
    >
      <Text style={[styles.text, emphasis && styles.textEmphasis]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    backgroundColor: ui.colors.surfaceMuted,
    borderRadius: ui.radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4
  },
  badgeEmphasis: {
    backgroundColor: ui.colors.accentSoft
  },
  text: {
    color: ui.colors.muted,
    fontSize: 11,
    fontWeight: "600"
  },
  textEmphasis: {
    color: ui.colors.accent,
    fontWeight: "700"
  }
});
