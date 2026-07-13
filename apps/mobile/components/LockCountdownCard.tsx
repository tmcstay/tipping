import { resolveCyclingStageClosureState } from "@tipping-suite/tipping-core";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { buildClosureDisplay } from "../lib/stageClosureExperience";
import { formatDateTime } from "../lib/formatters";
import { InfoCard } from "./InfoCard";
import { StageStatusBadge } from "./StageStatusBadge";
import { ui } from "./theme";

export function LockCountdownCard({
  locksAt,
  startsAt,
  manualLockedAt = null,
  isFinal = false
}: {
  locksAt: string | null;
  startsAt: string | null;
  manualLockedAt?: string | null;
  isFinal?: boolean;
}) {
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => refresh((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Resolved once per render, reused for both the semantic state and the
  // display formatting below - never re-reads the clock mid-calculation.
  const now = new Date();
  const state = resolveCyclingStageClosureState({ startsAt, locksAt, manualLockedAt, isFinal, now });
  const display = buildClosureDisplay({
    state,
    locksAt,
    now,
    formattedLockDateTime: formatDateTime(locksAt)
  });

  return (
    <InfoCard title="Tip lock status" meta={locksAt ? formatDateTime(locksAt) : "Time TBC"}>
      <View style={styles.row}>
        <StageStatusBadge emphasis={display.emphasis} label={display.badgeLabel} tone={state} />
        <View style={styles.copy}>
          <Text style={[styles.value, !display.editable && styles.valueMuted]}>{display.primaryLabel}</Text>
          <Text style={styles.helper}>
            {display.editable
              ? "Submit before the countdown reaches zero."
              : "Picks can now be viewed, but not changed."}
          </Text>
        </View>
      </View>
    </InfoCard>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1 },
  helper: { color: ui.colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  row: { alignItems: "center", flexDirection: "row", gap: 12 },
  value: { color: ui.colors.primary, fontSize: 20, fontWeight: "900" },
  valueMuted: { color: ui.colors.muted }
});
