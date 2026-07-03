import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatOrdinal } from "../lib/formatters";

type Props = {
  activePosition: number | null;
  disabled?: boolean;
  itemName: (id: string) => string;
  itemLabel: "rider" | "team";
  topFive: (string | null)[];
  onActivate: (position: number) => void;
  onClear: (position: number) => void;
};

export function OrderedTopFivePicker({ activePosition, disabled, itemName, itemLabel, topFive, onActivate, onClear }: Props) {
  return (
    <View style={styles.list}>
      {Array.from({ length: 5 }, (_, index) => {
        const itemId = topFive[index] ?? null;
        const position = index + 1;
        return (
          <Pressable
            disabled={disabled}
            key={position}
            onPress={() => onActivate(position)}
            style={[styles.slot, activePosition === position && styles.active, disabled && styles.disabled]}
          >
            <View style={styles.positionWrap}>
              <Text style={styles.position}>{position}</Text>
              <Text style={styles.ordinal}>{formatOrdinal(position)}</Text>
            </View>
            <View style={styles.copy}>
              <Text style={itemId ? styles.name : styles.empty}>{itemId ? itemName(itemId) : `Select ${itemLabel}`}</Text>
              <Text style={styles.hint}>{itemId ? "Tap to change" : `${itemLabel === "team" ? "Team" : "Rider"} predicted ${formatOrdinal(position)}`}</Text>
            </View>
            {itemId && !disabled ? (
              <Pressable accessibilityLabel={`Clear position ${position}`} onPress={() => onClear(position)} style={styles.clearButton}>
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
            ) : (
              <Text style={styles.chevron}>›</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  active: { borderColor: "#12372A", borderWidth: 2 },
  chevron: { color: "#9AA6A0", fontSize: 28, fontWeight: "500" },
  clear: { color: "#A12622", fontSize: 12, fontWeight: "900" },
  clearButton: { padding: 8 },
  copy: { flex: 1 },
  disabled: { opacity: 0.65 },
  empty: { color: "#68746D", fontSize: 16, fontWeight: "800" },
  hint: { color: "#68746D", fontSize: 12, fontWeight: "700", marginTop: 3 },
  list: { gap: 10 },
  name: { color: "#17231C", fontSize: 16, fontWeight: "900" },
  ordinal: { color: "#12372A", fontSize: 10, fontWeight: "900", marginTop: 2 },
  position: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  positionWrap: {
    alignItems: "center",
    backgroundColor: "#12372A",
    borderRadius: 16,
    justifyContent: "center",
    minHeight: 48,
    width: 48
  },
  slot: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#D8DED9",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 76,
    padding: 12
  }
});
