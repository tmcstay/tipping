import { Pressable, StyleSheet, Text, View } from "react-native";

export type JerseyKey = "yellow" | "green" | "kom" | "white";

const jerseys: { key: JerseyKey; label: string; helper: string; color: string; textColor: string }[] = [
  { key: "yellow", label: "Yellow Jersey", helper: "General classification", color: "#F2D43D", textColor: "#322B00" },
  { key: "green", label: "Green Jersey", helper: "Points classification", color: "#299447", textColor: "#FFFFFF" },
  { key: "kom", label: "Polka Dot Jersey", helper: "King of the Mountains", color: "#FFFFFF", textColor: "#D84A43" },
  { key: "white", label: "White Jersey", helper: "Best young rider", color: "#F7F7F7", textColor: "#17231C" }
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
            <View style={[styles.swatch, { backgroundColor: jersey.color }, jersey.key === "kom" && styles.polka]}>
              <Text style={[styles.swatchText, { color: jersey.textColor }]}>{jersey.key === "kom" ? "••" : ""}</Text>
            </View>
            <View style={styles.copy}>
              <Text style={styles.label}>{jersey.label}</Text>
              <Text style={styles.helper}>{jersey.helper}</Text>
              <Text style={riderId ? styles.rider : styles.empty}>{riderId ? riderName(riderId) : "Select rider"}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  active: { borderColor: "#12372A", borderWidth: 2 },
  chevron: { color: "#9AA6A0", fontSize: 28 },
  copy: { flex: 1 },
  disabled: { opacity: 0.65 },
  empty: { color: "#68746D", fontSize: 14, fontWeight: "800", marginTop: 5 },
  helper: { color: "#68746D", fontSize: 12, marginTop: 1 },
  label: { color: "#17231C", fontSize: 15, fontWeight: "900" },
  list: { gap: 10 },
  polka: { borderColor: "#D84A43", borderWidth: 2 },
  rider: { color: "#12372A", fontSize: 14, fontWeight: "900", marginTop: 5 },
  row: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#D8DED9", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 12, minHeight: 80, padding: 12 },
  swatch: { alignItems: "center", borderColor: "#B5B5B5", borderRadius: 10, borderWidth: 1, height: 48, justifyContent: "center", width: 38 },
  swatchText: { fontSize: 15, fontWeight: "900", letterSpacing: -2 }
});
