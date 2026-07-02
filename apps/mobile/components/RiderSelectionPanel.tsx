import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { CyclingStartlistRider } from "@tipping-suite/supabase-client";

type Props = {
  excludedRiderIds?: string[];
  riders: CyclingStartlistRider[];
  title: string;
  onSelect: (riderId: string) => void;
};

export function RiderSelectionPanel({ excludedRiderIds = [], riders, title, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return riders.filter((entry) => !query
      || entry.rider.display_name.toLocaleLowerCase().includes(query)
      || entry.team?.name.toLocaleLowerCase().includes(query));
  }, [riders, search]);

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{title}</Text>
      <TextInput accessibilityLabel="Search riders" onChangeText={setSearch} placeholder="Search riders or teams" style={styles.search} value={search} />
      <View style={styles.list}>
        {filtered.map((entry) => {
          const excluded = excludedRiderIds.includes(entry.rider.id);
          return (
            <Pressable disabled={excluded} key={entry.id} onPress={() => onSelect(entry.rider.id)} style={[styles.rider, excluded && styles.disabled]}>
              <View style={styles.copy}>
                <Text style={styles.name}>{entry.rider.display_name}</Text>
                <Text style={styles.team}>{entry.team?.name ?? "Team TBC"}</Text>
              </View>
              <Text style={styles.action}>{excluded ? "Already selected" : "Select"}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { color: "#12372A", fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  copy: { flex: 1 },
  disabled: { opacity: 0.4 },
  list: { gap: 6, marginTop: 10 },
  name: { color: "#17231C", fontSize: 14, fontWeight: "800" },
  panel: { backgroundColor: "#EEF2EF", borderRadius: 10, padding: 12 },
  rider: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 8, flexDirection: "row", minHeight: 52, padding: 10 },
  search: { backgroundColor: "#FFFFFF", borderColor: "#C9D1CB", borderRadius: 8, borderWidth: 1, marginTop: 8, minHeight: 44, paddingHorizontal: 12 },
  team: { color: "#68746D", fontSize: 12, marginTop: 2 },
  title: { color: "#17231C", fontSize: 15, fontWeight: "900" }
});
