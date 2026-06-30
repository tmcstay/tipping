import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CyclingLeaderboardRow } from "@tipping-suite/supabase-client";

import { AppShell } from "../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import { InfoCard } from "../components/InfoCard";
import {
  useCyclingCompetition,
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
  const race = useCyclingRace(2026);
  const competition = useCyclingCompetition(race.data?.id);
  const leaderboard = useCyclingLeaderboard(competition.data?.id, leaderboardType);

  return (
    <AppShell
      title="Cycling leaderboard"
      subtitle="Daily stage points, preselection points, and their combined overall score."
    >
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

      {race.loading || competition.loading || leaderboard.loading ? <LoadingState /> : null}
      {race.error ? <ErrorState error={race.error} onRetry={race.reload} /> : null}
      {competition.error ? <ErrorState error={competition.error} onRetry={competition.reload} /> : null}
      {leaderboard.error ? <ErrorState error={leaderboard.error} onRetry={leaderboard.reload} /> : null}
      {!leaderboard.loading && !leaderboard.error && leaderboard.data?.length === 0 ? (
        <EmptyState message="No stage scores yet. Leaderboard rows appear after results are entered and scored." />
      ) : null}
      {!leaderboard.loading && !leaderboard.error && leaderboard.data?.map((row) => (
        <InfoCard
          title={`Entry ${row.user_id.slice(0, 8)}`}
          meta={`Rank ${row.rank}`}
          key={row.id}
        >
          <View style={styles.row}>
            <Text style={styles.points}>{row.total_score} pts</Text>
            <Text style={styles.copy}>{row.stages_tipped} stages tipped</Text>
          </View>
        </InfoCard>
      ))}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  copy: { color: "#536159", fontSize: 14 },
  points: { color: "#12372A", fontSize: 18, fontWeight: "800" },
  row: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  tab: { alignItems: "center", borderRadius: 8, flex: 1, padding: 10 },
  tabActive: { backgroundColor: "#12372A" },
  tabText: { color: "#536159", fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  tabTextActive: { color: "#FFFFFF" },
  tabs: { backgroundColor: "#EEF2EF", borderRadius: 10, flexDirection: "row", padding: 4 }
});
