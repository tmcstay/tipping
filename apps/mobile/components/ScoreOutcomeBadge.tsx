import { StyleSheet, Text, View } from "react-native";

import type { JerseyBadgeTone } from "../lib/grandtourStageResultsExperience";
import { ui } from "./theme";

export type ScoreOutcomeBadgeTone = JerseyBadgeTone;

/**
 * The one shared colour system for every "how did this pick score" badge
 * in the app - previously duplicated three times with three different
 * palettes (this results-screen scheme; My Tips' Top 5 comparison, which
 * used amber for a wrong-position match; My Tips' jersey comparison, which
 * used red for a miss). Now every screen that shows a scored pick imports
 * this instead of hardcoding its own colours:
 *
 * - exact (green): picked this rider/team at exactly the right position,
 *   or the correct jersey holder.
 * - partial (blue): picked the right rider/team, wrong position. No
 *   equivalent for jerseys (a jersey pick is binary).
 * - none (neutral grey): no pick, or the pick missed entirely. Never red -
 *   red stays reserved for genuine errors elsewhere in this app.
 * - pending (neutral grey, distinct wording only): not yet scored. Kept as
 *   its own tone rather than folded into "none" so callers can word it
 *   differently ("Pending") without implying a real miss.
 *
 * "none" deliberately uses `border` (not `surfaceMuted`) as its background.
 * This badge renders on two different row backgrounds depending on the
 * screen - StageResultCard's rows are `surfaceMuted`, My Tips' comparison
 * rows are plain white (`surface`) - and `border` is the one neutral tone
 * in this palette dark enough to stay visible against both, rather than
 * disappearing on whichever row happens to share its own background.
 */
export const SCORE_OUTCOME_BADGE_COLORS: Record<ScoreOutcomeBadgeTone, { backgroundColor: string; color: string }> = {
  exact: { backgroundColor: ui.colors.positiveSoft, color: ui.colors.positiveStrong },
  partial: { backgroundColor: ui.colors.accentSoft, color: ui.colors.accent },
  none: { backgroundColor: ui.colors.border, color: ui.colors.faint },
  pending: { backgroundColor: ui.colors.warningSoft, color: ui.colors.warning }
};

export type ScoreOutcomeBadgeProps = {
  tone: ScoreOutcomeBadgeTone;
  label: string;
};

/** Ready-made standalone badge for the common case (a single position/label pair). Screens whose row layout needs the colour inline in a differently-shaped chip can use SCORE_OUTCOME_BADGE_COLORS directly instead - see GrandTourTopFiveComparison/GrandTourJerseyComparison. */
export function ScoreOutcomeBadge({ label, tone }: ScoreOutcomeBadgeProps) {
  const style = SCORE_OUTCOME_BADGE_COLORS[tone];
  return (
    <View style={[styles.badge, { backgroundColor: style.backgroundColor }]}>
      <Text style={[styles.text, { color: style.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: ui.radius.pill,
    justifyContent: "center",
    minWidth: 40,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  text: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    fontWeight: "800"
  }
});
