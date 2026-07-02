import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  activePosition: number | null;
  disabled?: boolean;
  riderName: (id: string) => string;
  topFive: (string | null)[];
  onActivate: (position: number) => void;
  onClear: (position: number) => void;
};

export function OrderedTopFivePicker({ activePosition, disabled, riderName, topFive, onActivate, onClear }: Props) {
  return (
    <View style={styles.list}>
      {Array.from({ length: 5 }, (_, index) => {
        const riderId = topFive[index] ?? null;
        const position = index + 1;
        return (
          <Pressable
            disabled={disabled}
            key={position}
            onPress={() => onActivate(position)}
            style={[styles.slot, activePosition === position && styles.active, disabled && styles.disabled]}
          >
            <Text style={styles.position}>{position}</Text>
            <View style={styles.copy}>
              <Text style={styles.name}>{riderId ? riderName(riderId) : "Choose rider"}</Text>
              <Text style={styles.hint}>{riderId ? "Tap to replace" : `Predicted position ${position}`}</Text>
            </View>
            {riderId && !disabled ? (
              <Pressable accessibilityLabel={`Clear position ${position}`} onPress={() => onClear(position)}>
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  active: { borderColor: "#12372A", borderWidth: 2 },
  clear: { color: "#A12622", fontSize: 12, fontWeight: "800", padding: 8 },
  copy: { flex: 1 },
  disabled: { opacity: 0.65 },
  hint: { color: "#68746D", fontSize: 12, marginTop: 2 },
  list: { gap: 8 },
  name: { color: "#17231C", fontSize: 15, fontWeight: "800" },
  position: { backgroundColor: "#12372A", borderRadius: 18, color: "#FFFFFF", fontSize: 16, fontWeight: "900", overflow: "hidden", paddingVertical: 7, textAlign: "center", width: 36 },
  slot: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#D8DED9", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 12, minHeight: 62, padding: 10 }
});
