import { StyleSheet, Text, View } from "react-native";
import type { GrandTourTipStatus } from "@tipping-suite/shared-types";

import { ui } from "./theme";

export type TipDisplayStatus = GrandTourTipStatus | "not_started" | "missed" | "voided" | "corrected";

const labels: Record<TipDisplayStatus, string> = {
  not_started: "Not started",
  draft: "Draft only",
  submitted: "Submitted",
  locked: "Locked",
  scored: "Scored",
  missed: "Missed",
  voided: "Voided",
  corrected: "Corrected",
  deleted: "Deleted"
};

export function TipStatusBadge({ status }: { status: TipDisplayStatus }) {
  return (
    <View style={styles.badge}>
      <Text style={[styles.text, ["missed", "voided"].includes(status) && styles.textMuted]}>{labels[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", backgroundColor: ui.colors.surfaceMuted, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  text: { color: ui.colors.ink, fontSize: 11, fontWeight: "600" },
  textMuted: { color: ui.colors.muted }
});
