import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatOrdinal } from "../lib/formatters";
import { ui } from "./theme";

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
  active: { borderColor: ui.colors.primary, borderWidth: 2 },
  chevron: { color: ui.colors.faint, fontSize: 28, fontWeight: "500" },
  clear: { color: ui.colors.danger, fontSize: 12, fontWeight: "700" },
  clearButton: { padding: 8 },
  copy: { flex: 1 },
  disabled: { opacity: 0.65 },
  empty: { color: ui.colors.muted, fontSize: 16, fontWeight: "600" },
  hint: { color: ui.colors.faint, fontSize: 12, fontWeight: "500", marginTop: 3 },
  list: { gap: 10 },
  name: { color: ui.colors.ink, fontSize: 16, fontWeight: "700" },
  ordinal: { color: "#FFFFFF", fontSize: 10, fontWeight: "700", marginTop: 2 },
  position: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  positionWrap: {
    alignItems: "center",
    backgroundColor: ui.colors.primary,
    borderRadius: 16,
    justifyContent: "center",
    minHeight: 48,
    width: 48
  },
  slot: {
    alignItems: "center",
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 76,
    padding: 12
  }
});
