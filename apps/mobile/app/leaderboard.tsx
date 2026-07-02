import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CyclingLeaderboardRow } from "@tipping-suite/supabase-client";

import { AppShell } from "../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import { InfoCard } from "../components/InfoCard";
import {
  useCyclingCompetitions,
  useCyclingLeaderboard,
  useCyclingRace
} from "../hooks/useCyclingData";

const leaderboardTypes: CyclingLeaderboardRow["leaderboard_type"][] = [
  "daily",
  "preselection",
  "overall"
];

export default function LeaderboardScreen() {
  const [leaderboardType, setLeaderboardType] = useState<CyclingLeaderboardRow["leaderboard_type"]>("overall");
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const race = useCyclingRace(2026);
  const competitions = useCyclingCompetitions(race.data?.id);
  useEffect(() => {
    if (!competitionId && competitions.data?.[0]) setCompetitionId(competitions.data[0].id);
  }, [competitionId, competitions.data]);
  const leaderboard = useCyclingLeaderboard(competitionId, leaderboardType);

  return (
    <AppShell
      title="Cycling leaderboard"
      subtitle="Public and private leagues available to your account."
    >
      <View style={styles.leagues}>
        {competitions.data?.map((competition) => (
          <Pressable key={competition.id} onPress={() => setCompetitionId(competition.id)} style={[styles.league, competitionId === competition.id && styles.leagueActive]}>
            <Text style={[styles.leagueText, competitionId === competition.id && styles.leagueTextActive]}>
              {competition.name}{competition.is_public ? "" : " · Private"}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.tabs}>
        {leaderboardTypes.map((type) => (
          <Pressable
            key={type}
            onPress={() => setLeaderboardType(type)}
            style={[styles.tab, leaderboardType === type && styles.tabActive]}
          >
            <Text style={[styles.tabText, leaderboardType === type && styles.tabTextActive]}>{type}</Text>
          </Pressable>
        ))}
      </View>

      {race.loading || competitions.loading || leaderboard.loading ? <LoadingState /> : null}
      {race.error ? <ErrorState error={race.error} onRetry={race.reload} /> : null}
      {competitions.error ? <ErrorState error={competitions.error} onRetry={competitions.reload} /> : null}
      {leaderboard.error ? <ErrorState error={leaderboard.error} onRetry={leaderboard.reload} /> : null}
      {!leaderboard.loading && !leaderboard.error && leaderboard.data?.length === 0 ? (
        <EmptyState message="No stage scores yet. Leaderboard rows appear after results are entered and scored." />
      ) : null}
      {!leaderboard.loading && !leaderboard.error && leaderboard.data?.map((row) => (
        <InfoCard
          title={row.display_name}
          meta={`Rank ${row.rank}${row.is_dummy ? " · Dummy user" : ""}`}
          key={row.id}
        >
          <View style={styles.row}>
            <Text style={styles.points}>{row.total_score} pts</Text>
            <Text style={styles.copy}>{row.stages_tipped} stages tipped</Text>
          </View>
          {row.is_dummy ? <Text style={styles.dummy}>Dummy entry · not prize eligible</Text> : null}
        </InfoCard>
      ))}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  copy: { color: "#536159", fontSize: 14 },
  dummy: { color: "#8A5A00", fontSize: 12, fontWeight: "800" },
  league: { borderColor: "#C9D1CB", borderRadius: 8, borderWidth: 1, padding: 10 },
  leagueActive: { backgroundColor: "#E3EEE7", borderColor: "#12372A" },
  leagues: { gap: 6 },
  leagueText: { color: "#536159", fontSize: 13, fontWeight: "800" },
  leagueTextActive: { color: "#12372A" },
  points: { color: "#12372A", fontSize: 18, fontWeight: "800" },
  row: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  tab: { alignItems: "center", borderRadius: 8, flex: 1, padding: 10 },
  tabActive: { backgroundColor: "#12372A" },
  tabText: { color: "#536159", fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  tabTextActive: { color: "#FFFFFF" },
  tabs: { backgroundColor: "#EEF2EF", borderRadius: 10, flexDirection: "row", padding: 4 }
});
