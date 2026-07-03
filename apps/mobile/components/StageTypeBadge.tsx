import { StyleSheet, Text, View } from "react-native";

import { formatStageType } from "../lib/formatters";
import { getStageTipExperience } from "../lib/stageExperience";

export function StageTypeBadge({ stageType }: { stageType: string | null | undefined }) {
  const experience = getStageTipExperience(stageType);
  return (
    <View style={[styles.badge, experience.isTtt && styles.ttt]}>
      <Text style={[styles.text, experience.isTtt && styles.tttText]}>
        {experience.isTtt ? "Team Time Trial" : formatStageType(stageType)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#EAF2ED",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  text: { color: "#12372A", fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  ttt: { backgroundColor: "#E8E5FF" },
  tttText: { color: "#3A2F8F" }
});
