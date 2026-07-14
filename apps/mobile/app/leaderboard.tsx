import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CyclingLeaderboardRow } from "@tipping-suite/supabase-client";

import { useAuth } from "../auth/useAuth";
import { AppShell } from "../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import {
  useCyclingCompetitions,
  useCyclingLeaderboard,
  useCyclingRace
} from "../hooks/useCyclingData";
import { buildLeaderboardDisplayItems } from "../lib/leaderboardExperience";
import { ui } from "../components/theme";

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
  const { user } = useAuth();
  const [leaderboardType, setLeaderboardType] = useState<CyclingLeaderboardRow["leaderboard_type"]>("overall");
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const race = useCyclingRace(2026);
  const competitions = useCyclingCompetitions(race.data?.id);
  useEffect(() => {
    if (!competitionId && competitions.data?.[0]) setCompetitionId(competitions.data[0].id);
  }, [competitionId, competitions.data]);
  const leaderboard = useCyclingLeaderboard(competitionId, leaderboardType);

  const displayItems = buildLeaderboardDisplayItems(leaderboard.data ?? [], user?.id ?? null);

  return (
    <AppShell title="Leaderboard" subtitle="Overall standings, stage tipping, and pre-race results.">
      {competitions.data && competitions.data.length > 1 ? (
        <View style={styles.leagues}>
          {competitions.data.map((competition) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: competitionId === competition.id }}
              key={competition.id}
              onPress={() => setCompetitionId(competition.id)}
              style={[styles.league, competitionId === competition.id && styles.leagueActive]}
            >
              <Text style={[styles.leagueText, competitionId === competition.id && styles.leagueTextActive]}>
                {competition.name}{competition.is_public ? "" : " · Private"}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.tabs}>
        {leaderboardTypes.map((type) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: leaderboardType === type }}
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

      {!leaderboard.loading && !leaderboard.error && displayItems.length > 0 ? (
        <View style={styles.table}>
          <View style={styles.headerRow}>
            <Text style={[styles.headerCell, styles.rankCell]}>Rank</Text>
            <Text style={[styles.headerCell, styles.playerCell]}>Player</Text>
            <Text style={[styles.headerCell, styles.pointsCell]}>Points</Text>
          </View>
          {displayItems.map((item, index) =>
            item.type === "divider" ? (
              <View key="divider" style={styles.divider}>
                <Text style={styles.dividerText}>⋯</Text>
              </View>
            ) : (
              <View
                key={item.row.id}
                style={[styles.row, item.isCurrentUser && styles.rowCurrentUser, index === displayItems.length - 1 && styles.rowLast]}
              >
                <Text style={[styles.rankCell, styles.rankText]}>{item.row.rank}</Text>
                <View style={styles.playerCell}>
                  <View style={styles.playerNameRow}>
                    <Text numberOfLines={1} style={styles.playerName}>{item.row.display_name}</Text>
                    {item.isCurrentUser ? (
                      <View style={styles.youPill}>
                        <Text style={styles.youPillText}>You</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.playerMeta}>{item.row.stages_tipped} stage{item.row.stages_tipped === 1 ? "" : "s"} tipped</Text>
                </View>
                <View style={styles.pointsCell}>
                  <Text style={styles.pointsText}>{item.row.total_score}</Text>
                  {item.row.last_stage_score !== null ? (
                    <Text style={styles.lastStageText}>+{item.row.last_stage_score} last</Text>
                  ) : null}
                </View>
              </View>
            )
          )}
        </View>
      ) : null}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  divider: {
    alignItems: "center",
    paddingVertical: 6
  },
  dividerText: {
    color: ui.colors.faint,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 2
  },
  headerCell: {
    color: ui.colors.faint,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  headerRow: {
    borderBottomColor: ui.colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    paddingBottom: 8,
    paddingHorizontal: 4
  },
  lastStageText: {
    color: ui.colors.faint,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 1
  },
  league: {
    borderColor: ui.colors.border,
    borderRadius: ui.radius.small,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  leagueActive: {
    backgroundColor: ui.colors.primarySoft,
    borderColor: ui.colors.primary
  },
  leagueText: {
    color: ui.colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  leagueTextActive: {
    color: ui.colors.primary
  },
  leagues: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  playerCell: {
    flex: 1,
    paddingHorizontal: 8
  },
  playerMeta: {
    color: ui.colors.faint,
    fontSize: 12,
    marginTop: 1
  },
  playerName: {
    color: ui.colors.ink,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "600"
  },
  playerNameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6
  },
  pointsCell: {
    alignItems: "flex-end",
    width: 72
  },
  pointsText: {
    color: ui.colors.ink,
    fontSize: 15,
    fontVariant: ["tabular-nums"],
    fontWeight: "700"
  },
  rankCell: {
    width: 32
  },
  rankText: {
    color: ui.colors.muted,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    fontWeight: "700"
  },
  row: {
    alignItems: "center",
    borderBottomColor: ui.colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: 4,
    paddingVertical: 8
  },
  rowCurrentUser: {
    backgroundColor: ui.colors.accentSoft
  },
  rowLast: {
    borderBottomWidth: 0
  },
  tab: {
    alignItems: "center",
    borderRadius: ui.radius.small,
    flex: 1,
    minHeight: 40,
    justifyContent: "center"
  },
  tabActive: {
    backgroundColor: ui.colors.primary
  },
  tabs: {
    backgroundColor: ui.colors.surfaceMuted,
    borderRadius: ui.radius.medium,
    flexDirection: "row",
    gap: 2,
    padding: 4
  },
  tabText: {
    color: ui.colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  tabTextActive: {
    color: "#FFFFFF"
  },
  table: {
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.large,
    borderWidth: 1,
    padding: 12
  },
  youPill: {
    backgroundColor: ui.colors.primary,
    borderRadius: ui.radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2
  },
  youPillText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700"
  }
});
