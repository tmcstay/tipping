import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { formatDurationUntil, formatTime } from "../lib/formatters";
import { InfoCard } from "./InfoCard";
import { ui } from "./theme";

export function LockCountdownCard({ locksAt }: { locksAt: string | null }) {
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => refresh((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const locked = !locksAt || new Date(locksAt).getTime() <= Date.now();

  return (
    <InfoCard title={locked ? "Tips locked" : "Tip lock countdown"} meta={locksAt ? formatTime(locksAt) : "Time TBC"}>
      <View style={styles.row}>
        <View style={[styles.dot, locked && styles.dotLocked]} />
        <View style={styles.copy}>
          <Text style={[styles.value, locked && styles.locked]}>{formatDurationUntil(locksAt)}</Text>
          <Text style={styles.helper}>{locked ? "Picks can now be viewed, but not changed." : "Submit before the countdown reaches zero."}</Text>
        </View>
      </View>
    </InfoCard>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1 },
  dot: { backgroundColor: ui.colors.success, borderRadius: 8, height: 12, width: 12 },
  dotLocked: { backgroundColor: ui.colors.muted },
  helper: { color: ui.colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  locked: { color: ui.colors.muted },
  row: { alignItems: "center", flexDirection: "row", gap: 12 },
  value: { color: ui.colors.primary, fontSize: 20, fontWeight: "900" }
});
