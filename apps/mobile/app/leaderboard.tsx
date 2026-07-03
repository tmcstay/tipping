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
  "overall",
  "daily",
  "preselection"
];

function leaderboardLabel(type: CyclingLeaderboardRow["leaderboard_type"]) {
  if (type === "overall") return "Overall";
  if (type === "daily") return "Stage";
  return "Pre-race";
}

export default function LeaderboardScreen() {
  const [leaderboardType, setLeaderboardType] = useState<CyclingLeaderboardRow["leaderboard_type"]>("overall");
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const race = useCyclingRace(2026);
  const competitions = useCyclingCompetitions(race.data?.id);
  useEffect(() => {
    if (!competitionId && competitions.data?.[0]) setCompetitionId(competitions.data[0].id);
  }, [competitionId, competitions.data]);
  const leaderboard = useCyclingLeaderboard(competitionId, leaderboardType);
  const leader = leaderboard.data?.[0] ?? null;

  return (
    <AppShell
      title="Leaderboard"
      subtitle="See the overall race, stage tipping, and pre-race competitions."
    >
      {leader ? (
        <InfoCard accent title={`${leader.display_name} leads`} meta={`${leader.total_score} points`}>
          <Text style={styles.heroCopy}>Top score in {leaderboardLabel(leaderboardType).toLowerCase()} leaderboard.</Text>
          <Text style={styles.heroCopy}>{leader.stages_tipped} stages tipped{leader.is_dummy ? " · Dummy user" : ""}</Text>
        </InfoCard>
      ) : null}

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
            <Text style={[styles.tabText, leaderboardType === type && styles.tabTextActive]}>{leaderboardLabel(type)}</Text>
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
            <View style={styles.rankBubble}>
              <Text style={styles.rankText}>{row.rank}</Text>
            </View>
            <View style={styles.entryCopy}>
              <Text style={styles.points}>{row.total_score} pts</Text>
              <Text style={styles.copy}>{row.stages_tipped} stages tipped</Text>
            </View>
            {row.last_stage_score !== null ? (
              <View style={styles.lastStagePill}>
                <Text style={styles.lastStageLabel}>Last</Text>
                <Text style={styles.lastStageScore}>+{row.last_stage_score}</Text>
              </View>
            ) : null}
          </View>
          {row.is_dummy ? <Text style={styles.dummy}>Dummy entry · not prize eligible</Text> : null}
        </InfoCard>
      ))}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  copy: { color: "#536159", fontSize: 14 },
  dummy: { color: "#8A5A00", fontSize: 12, fontWeight: "900" },
  entryCopy: { flex: 1 },
  heroCopy: { color: "#E7F1EA", fontSize: 14, lineHeight: 20 },
  lastStageLabel: { color: "#68746D", fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  lastStagePill: { alignItems: "center", backgroundColor: "#EAF2ED", borderRadius: 14, minWidth: 58, paddingHorizontal: 10, paddingVertical: 6 },
  lastStageScore: { color: "#12372A", fontSize: 15, fontWeight: "900" },
  league: { borderColor: "#C9D1CB", borderRadius: 12, borderWidth: 1, padding: 11 },
  leagueActive: { backgroundColor: "#E3EEE7", borderColor: "#12372A" },
  leagues: { gap: 8 },
  leagueText: { color: "#536159", fontSize: 13, fontWeight: "900" },
  leagueTextActive: { color: "#12372A" },
  points: { color: "#12372A", fontSize: 19, fontWeight: "900" },
  rankBubble: { alignItems: "center", backgroundColor: "#12372A", borderRadius: 20, height: 40, justifyContent: "center", width: 40 },
  rankText: { color: "#FFFFFF", fontWeight: "900" },
  row: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  tab: { alignItems: "center", borderRadius: 12, flex: 1, padding: 11 },
  tabActive: { backgroundColor: "#12372A" },
  tabText: { color: "#536159", fontSize: 12, fontWeight: "900" },
  tabTextActive: { color: "#FFFFFF" },
  tabs: { backgroundColor: "#EEF2EF", borderRadius: 14, flexDirection: "row", padding: 4 }
});
