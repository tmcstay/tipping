import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export type StageTeam = {
  id: string;
  name: string;
  code: string | null;
};

type Props = {
  excludedTeamIds?: string[];
  teams: StageTeam[];
  title: string;
  onSelect: (teamId: string) => void;
};

export function TeamSelectionPanel({ excludedTeamIds = [], teams, title, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return teams.filter((team) => !query
      || team.name.toLocaleLowerCase().includes(query)
      || team.code?.toLocaleLowerCase().includes(query));
  }, [search, teams]);

  return (
    <View style={styles.panel}>
      <View style={styles.handle} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>Team Time Trial stage result picks use teams.</Text>
      <TextInput
        accessibilityLabel="Search teams"
        onChangeText={setSearch}
        placeholder="Search teams"
        style={styles.search}
        value={search}
      />
      <View style={styles.list}>
        {filtered.map((team) => {
          const excluded = excludedTeamIds.includes(team.id);
          return (
            <Pressable
              disabled={excluded}
              key={team.id}
              onPress={() => onSelect(team.id)}
              style={[styles.team, excluded && styles.disabled]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{team.code?.slice(0, 3) ?? team.name.slice(0, 2)}</Text>
              </View>
              <View style={styles.copy}>
                <Text style={styles.name}>{team.name}</Text>
                {team.code ? <Text style={styles.code}>{team.code}</Text> : null}
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
  avatar: { alignItems: "center", backgroundColor: "#E8E5FF", borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  avatarText: { color: "#3A2F8F", fontSize: 11, fontWeight: "900" },
  code: { color: "#68746D", fontSize: 12, marginTop: 2 },
  copy: { flex: 1 },
  disabled: { opacity: 0.38 },
  handle: { alignSelf: "center", backgroundColor: "#C9D1CB", borderRadius: 99, height: 4, marginBottom: 8, width: 48 },
  list: { gap: 8, marginTop: 12 },
  name: { color: "#17231C", fontSize: 15, fontWeight: "900" },
  panel: { backgroundColor: "#EEF2EF", borderColor: "#D7E1DA", borderRadius: 20, borderWidth: 1, padding: 14 },
  search: { backgroundColor: "#FFFFFF", borderColor: "#C9D1CB", borderRadius: 14, borderWidth: 1, marginTop: 10, minHeight: 48, paddingHorizontal: 12 },
  subtitle: { color: "#68746D", fontSize: 12, lineHeight: 17, marginTop: 4 },
  team: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E0E8E2", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 62, padding: 10 },
  title: { color: "#17231C", fontSize: 17, fontWeight: "900" }
});
