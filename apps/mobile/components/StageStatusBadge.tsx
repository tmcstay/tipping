import { StyleSheet, Text, View } from "react-native";

import { ui } from "./theme";

export type StageStatusTone = "open" | "closing_soon" | "closed" | "live" | "provisional" | "completed";

export type StageStatusBadgeProps = {
  tone: StageStatusTone;
  label: string;
  /** High-emphasis rendering (e.g. <60m-remaining closing_soon) - bolds the existing tone's text, never introduces a new hue. */
  emphasis?: boolean;
};

type BadgeStyle = { backgroundColor: string; textColor: string; showDot: boolean };

/**
 * Semantic per-status colour, matching the four stage statuses
 * (open/live/closed/completed) plus the two states this app additionally
 * tracks (closing_soon - a higher-emphasis Open; provisional - a
 * not-yet-final result, styled neutrally like closed). Never uses red for
 * "closed" - red is reserved for genuine errors. Status must also remain
 * understandable without colour alone, which is why every state has a
 * distinct label text, not just a colour swap.
 */
function resolveBadgeStyle(tone: StageStatusTone): BadgeStyle {
  switch (tone) {
    case "live":
      return { backgroundColor: ui.colors.positiveSoft, textColor: ui.colors.positiveStrong, showDot: true };
    case "completed":
      return { backgroundColor: ui.colors.primarySoft, textColor: ui.colors.primary, showDot: false };
    case "closed":
    case "provisional":
      return { backgroundColor: ui.colors.surfaceMuted, textColor: ui.colors.muted, showDot: false };
    case "open":
    case "closing_soon":
    default:
      return { backgroundColor: ui.colors.accentSoft, textColor: ui.colors.accent, showDot: false };
  }
}

/**
 * One semantic chip per status tone. An earlier version of this component
 * ignored `tone` entirely (it accepted the prop but never read it, so every
 * status rendered as the same neutral pill regardless of what callers
 * passed) - this restores real per-status colour, now that the GWFC
 * three-colour palette gives enough distinct hues to do so meaningfully
 * without it reading as arbitrary decoration.
 */
export function StageStatusBadge({ emphasis, label, tone }: StageStatusBadgeProps) {
  const style = resolveBadgeStyle(tone);
  return (
    <View
      accessibilityElementsHidden
      style={[styles.badge, { backgroundColor: style.backgroundColor }]}
    >
      {style.showDot ? <View style={[styles.dot, { backgroundColor: style.textColor }]} /> : null}
      <Text style={[styles.text, { color: style.textColor }, emphasis && styles.textEmphasis]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: ui.radius.pill,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4
  },
  dot: {
    borderRadius: 3,
    height: 6,
    width: 6
  },
  text: {
    fontSize: 11,
    fontWeight: "600"
  },
  textEmphasis: {
    fontWeight: "700"
  }
});
