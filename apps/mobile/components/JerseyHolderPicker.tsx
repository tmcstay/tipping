import { Pressable, StyleSheet, Text, View } from "react-native";

export type JerseyKey = "yellow" | "green" | "kom" | "white";

const jerseys: { key: JerseyKey; label: string; color: string }[] = [
  { key: "yellow", label: "Yellow", color: "#F2D43D" },
  { key: "green", label: "Green", color: "#299447" },
  { key: "kom", label: "KOM / polka-dot", color: "#D84A43" },
  { key: "white", label: "White", color: "#E7E7E7" }
];

type Props = {
  activeJersey: JerseyKey | null;
  disabled?: boolean;
  selections: Partial<Record<JerseyKey, string>>;
  riderName: (id: string) => string;
  onActivate: (jersey: JerseyKey) => void;
};

export function JerseyHolderPicker({ activeJersey, disabled, selections, riderName, onActivate }: Props) {
  return (
    <View style={styles.list}>
      {jerseys.map((jersey) => {
        const riderId = selections[jersey.key];
        return (
          <Pressable
            disabled={disabled}
            key={jersey.key}
            onPress={() => onActivate(jersey.key)}
            style={[styles.row, activeJersey === jersey.key && styles.active, disabled && styles.disabled]}
          >
            <View style={[styles.swatch, { backgroundColor: jersey.color }]} />
            <View style={styles.copy}>
              <Text style={styles.label}>{jersey.label}</Text>
              <Text style={riderId ? styles.rider : styles.empty}>{riderId ? riderName(riderId) : "Choose rider"}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  active: { borderColor: "#12372A", borderWidth: 2 },
  copy: { flex: 1 },
  disabled: { opacity: 0.65 },
  empty: { color: "#68746D", fontSize: 13, marginTop: 2 },
  label: { color: "#17231C", fontSize: 14, fontWeight: "800" },
  list: { gap: 8 },
  rider: { color: "#12372A", fontSize: 13, fontWeight: "700", marginTop: 2 },
  row: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#D8DED9", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 12, minHeight: 58, padding: 10 },
  swatch: { borderColor: "#B5B5B5", borderRadius: 4, borderWidth: 1, height: 34, width: 28 }
});
