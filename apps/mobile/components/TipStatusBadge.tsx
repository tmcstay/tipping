import { StyleSheet, Text, View } from "react-native";
import type { GrandTourTipStatus } from "@tipping-suite/shared-types";

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
    <View style={[styles.badge, status === "draft" && styles.warning, ["missed", "voided"].includes(status) && styles.danger]}>
      <Text style={styles.text}>{labels[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", backgroundColor: "#DCE9E1", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  danger: { backgroundColor: "#F6D8D6" },
  text: { color: "#173A2D", fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  warning: { backgroundColor: "#FBE8B8" }
});
