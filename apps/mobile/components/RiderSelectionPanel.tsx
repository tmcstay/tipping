import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { CyclingStartlistRider } from "@tipping-suite/supabase-client";

import { formatRiderDisplayName, preferStageBibNumber } from "../lib/formatters";

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
      <View style={styles.handle} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>Search, then tap a rider card. Already selected riders are disabled for stage Top 5 picks.</Text>
      <TextInput accessibilityLabel="Search riders" onChangeText={setSearch} placeholder="Search riders or teams" style={styles.search} value={search} />
      <View style={styles.list}>
        {filtered.map((entry) => {
          const excluded = excludedRiderIds.includes(entry.rider.id);
          return (
            <Pressable disabled={excluded} key={entry.id} onPress={() => onSelect(entry.rider.id)} style={[styles.rider, excluded && styles.disabled]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{entry.rider.display_name.slice(0, 1)}</Text>
              </View>
              <View style={styles.copy}>
                <Text style={styles.name}>{formatRiderDisplayName(
                  entry.rider.display_name,
                  preferStageBibNumber(entry.bib_number, entry.rider.bib_number)
                )}</Text>
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
  avatar: { alignItems: "center", backgroundColor: "#EAF2ED", borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  avatarText: { color: "#12372A", fontWeight: "900" },
  copy: { flex: 1 },
  disabled: { opacity: 0.38 },
  handle: { alignSelf: "center", backgroundColor: "#C9D1CB", borderRadius: 99, height: 4, marginBottom: 8, width: 48 },
  list: { gap: 8, marginTop: 12 },
  name: { color: "#17231C", fontSize: 15, fontWeight: "900" },
  panel: { backgroundColor: "#EEF2EF", borderColor: "#D7E1DA", borderRadius: 20, borderWidth: 1, padding: 14 },
  rider: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E0E8E2", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 62, padding: 10 },
  search: { backgroundColor: "#FFFFFF", borderColor: "#C9D1CB", borderRadius: 14, borderWidth: 1, marginTop: 10, minHeight: 48, paddingHorizontal: 12 },
  subtitle: { color: "#68746D", fontSize: 12, lineHeight: 17, marginTop: 4 },
  team: { color: "#68746D", fontSize: 12, marginTop: 2 },
  title: { color: "#17231C", fontSize: 17, fontWeight: "900" }
});
