import { StyleSheet, Text, View } from "react-native";

import { formatStageType } from "../lib/formatters";
import { getStageTipExperience } from "../lib/stageExperience";
import { ui } from "./theme";

export function StageTypeBadge({ stageType }: { stageType: string | null | undefined }) {
  const experience = getStageTipExperience(stageType);
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>
        {experience.isTtt ? "Team time trial" : formatStageType(stageType)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    backgroundColor: ui.colors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4
  },
  text: { color: ui.colors.muted, fontSize: 11, fontWeight: "600" }
});
