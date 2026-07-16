import { useEffect, useState } from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import { formatLockCountdown, resolveCountdownTickIntervalMs } from "../lib/stageClosureExperience";
import { ui } from "./theme";

export type StageLockCountdownProps = {
  /** The already-resolved effective lock instant (manual override > stored locks_at > fallback - see resolveCyclingStageLockAt in @tipping-suite/tipping-core), not necessarily the stage's raw locks_at column. Null/undefined renders nothing. */
  lockAt: Date | string | null | undefined;
  style?: StyleProp<TextStyle>;
};

function toLockMs(lockAt: Date | string | null | undefined): number | null {
  if (!lockAt) return null;
  const ms = lockAt instanceof Date ? lockAt.getTime() : new Date(lockAt).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The one shared live-ticking "Closes in Xd Yh" / "Closed" text, used by
 * every stage card in the app instead of each screen computing its own
 * one-shot duration string. Purely cosmetic display - this is never the
 * source of truth for whether tip entry is actually still allowed. That
 * stays resolveCyclingStageClosureState's job (server-derived state) plus
 * the backend's own lock enforcement (RLS); this component reaching
 * "Closed" a moment before a screen's next data reload just means the text
 * updates slightly ahead of a UI that would refuse the submit anyway.
 *
 * Ticks itself via a self-rescheduling setTimeout (not a fixed
 * setInterval), so the interval can adapt every tick per
 * resolveCountdownTickIntervalMs - full-second precision only once the
 * deadline is close enough to matter, a slower cadence otherwise. Stops
 * scheduling once the countdown reaches zero; there is nothing left to
 * update.
 */
export function StageLockCountdown({ lockAt, style }: StageLockCountdownProps) {
  const [now, setNow] = useState(() => new Date());
  const lockMs = toLockMs(lockAt);

  useEffect(() => {
    if (lockMs === null) return undefined;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      const current = new Date();
      setNow(current);
      const remaining = lockMs - current.getTime();
      if (remaining <= 0) return; // Closed - nothing left to update, stop rescheduling.
      timer = setTimeout(tick, resolveCountdownTickIntervalMs(remaining));
    };
    timer = setTimeout(tick, resolveCountdownTickIntervalMs(lockMs - Date.now()));

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [lockMs]);

  if (lockMs === null) return null;
  const msRemaining = lockMs - now.getTime();

  return <Text style={style ?? styles.defaultText}>{formatLockCountdown(msRemaining)}</Text>;
}

const styles = StyleSheet.create({
  defaultText: {
    color: ui.colors.muted,
    fontSize: 13,
    fontWeight: "600"
  }
});
