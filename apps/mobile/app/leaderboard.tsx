import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { CyclingLeaderboardRow } from "@tipping-suite/supabase-client";

import { useAuth } from "../auth/useAuth";
import { AppShell } from "../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import {
  useCyclingCompetitions,
  useCyclingLeaderboard,
  useCyclingRace
} from "../hooks/useCyclingData";
import { formatGrandTourName } from "../lib/grandTourDisplay";
import {
  buildLeaderboardDisplayItems,
  buildParticipantDetailLink,
  formatRankMovement,
  getRankMovementTone,
  type RankMovementTone
} from "../lib/leaderboardExperience";
import { ui } from "../components/theme";

// Movement colour semantics: up = green, down = red, unchanged/new = blue.
// The raw GWFC Green fails small-text contrast on white, so "up" uses the
// theme's darker positiveStrong shade of the same hue.
const movementColors: Record<RankMovementTone, string> = {
  up: ui.colors.positiveStrong,
  down: ui.colors.danger,
  steady: ui.colors.accent
};

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

function matchesSearch(row: CyclingLeaderboardRow, query: string): boolean {
  if (!query.trim()) return true;
  return row.display_name.toLowerCase().includes(query.trim().toLowerCase());
}

export default function LeaderboardScreen() {
  const { user } = useAuth();
  const [leaderboardType, setLeaderboardType] = useState<CyclingLeaderboardRow["leaderboard_type"]>("overall");
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const race = useCyclingRace(2026);
  const competitions = useCyclingCompetitions(race.data?.id);
  useEffect(() => {
    if (!competitionId && competitions.data?.[0]) setCompetitionId(competitions.data[0].id);
  }, [competitionId, competitions.data]);
  const leaderboard = useCyclingLeaderboard(competitionId, leaderboardType);

  const me = leaderboard.data?.find((row) => row.user_id === user?.id) ?? null;
  const filteredRows = (leaderboard.data ?? []).filter((row) => matchesSearch(row, search));
  const displayItems = buildLeaderboardDisplayItems(filteredRows, user?.id ?? null);

  return (
    <AppShell
      raceName={formatGrandTourName(race.data)}
      title="Leaderboard"
      subtitle="Overall standings, stage tipping, and pre-race results."
    >
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

      {/* Always shown, even when the user is already visible in the top block below - a stable "where do I stand" answer. */}
      {!leaderboard.loading && !leaderboard.error && me ? (
        <View style={styles.meCard}>
          <Text style={styles.meLabel}>Your position</Text>
          <View style={styles.meRow}>
            <Text style={styles.meRank}>#{me.rank}</Text>
            <Text style={styles.meName} numberOfLines={1}>{me.display_name}</Text>
            <Text style={styles.mePoints}>{me.total_score}</Text>
            <Text style={[styles.meMovement, { color: movementColors[getRankMovementTone(me.rank, me.previous_rank)] }]}>
              {formatRankMovement(me.rank, me.previous_rank)}
            </Text>
          </View>
        </View>
      ) : null}

      {!leaderboard.loading && !leaderboard.error && (leaderboard.data?.length ?? 0) > 0 ? (
        <TextInput
          onChangeText={setSearch}
          placeholder="Search players"
          placeholderTextColor={ui.colors.faint}
          style={styles.search}
          value={search}
        />
      ) : null}

      {!leaderboard.loading && !leaderboard.error && (leaderboard.data?.length ?? 0) > 0 ? (
        <Text style={styles.sectionHeading}>Full leaderboard</Text>
      ) : null}

      {!leaderboard.loading && !leaderboard.error && displayItems.length > 0 ? (
        <View style={styles.table}>
          <View style={styles.headerRow}>
            {/* No "Rank" header label - the rank numbers below speak for themselves; a spacer keeps column alignment. */}
            <View style={styles.rankCell} />
            <Text style={[styles.headerCell, styles.playerCell]}>Player</Text>
            {/* Points/Move headers are centred, matching the centred values below them - not right-aligned. */}
            <Text style={[styles.headerCell, styles.headerCellCentered, styles.pointsHeaderCell]}>Points</Text>
            <Text style={[styles.headerCell, styles.headerCellCentered, styles.moveHeaderCell]}>Move</Text>
          </View>
          {displayItems.map((item, index) => {
            if (item.type === "divider") {
              return (
                <View key="divider" style={styles.divider}>
                  <Text style={styles.dividerText}>⋯</Text>
                </View>
              );
            }
            const participantLink = buildParticipantDetailLink(item.row.user_id, item.row.display_name);
            return (
              // The whole row is the tap target (not just the name) - it
              // navigates to that participant's tip history/scoring detail
              // page. Row-level flex layout lives on the inner rowInner
              // View, never on this Link-wrapped Pressable's own style -
              // per this app's own documented gotcha, a flexDirection set
              // directly on a Link/Pressable's style collapses to a
              // stacked layout on web once <Link asChild> clones it onto a
              // real <a> element.
              <Link asChild href={participantLink.href} key={item.row.id}>
                <Pressable
                  accessibilityHint={participantLink.accessibilityHint}
                  accessibilityLabel={participantLink.accessibilityLabel}
                  accessibilityRole="button"
                  style={[styles.row, item.isCurrentUser && styles.rowCurrentUser, index === displayItems.length - 1 && styles.rowLast]}
                >
                  <View style={styles.rowInner}>
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
                    </View>
                    <Text
                      style={[
                        styles.moveCell,
                        { color: movementColors[getRankMovementTone(item.row.rank, item.row.previous_rank)] }
                      ]}
                    >
                      {formatRankMovement(item.row.rank, item.row.previous_rank)}
                    </Text>
                    <Text style={styles.rowChevron}>›</Text>
                  </View>
                </Pressable>
              </Link>
            );
          })}
        </View>
      ) : null}

      {!leaderboard.loading && !leaderboard.error && (leaderboard.data?.length ?? 0) > 0 && displayItems.length === 0 ? (
        <EmptyState message="No players match your search." />
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
  headerCellCentered: {
    textAlign: "center"
  },
  headerRow: {
    borderBottomColor: ui.colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    paddingBottom: 8,
    paddingHorizontal: 4
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
  meCard: {
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.large,
    borderWidth: 1,
    padding: 14,
    shadowColor: ui.shadow.shadowColor,
    shadowOffset: ui.shadow.shadowOffset,
    shadowOpacity: ui.shadow.shadowOpacity,
    shadowRadius: ui.shadow.shadowRadius
  },
  meLabel: {
    color: ui.colors.faint,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 6,
    textTransform: "uppercase"
  },
  meMovement: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    fontWeight: "700"
  },
  meName: {
    color: ui.colors.ink,
    flex: 1,
    fontSize: 15,
    fontWeight: "700"
  },
  mePoints: {
    color: ui.colors.ink,
    fontSize: 17,
    fontVariant: ["tabular-nums"],
    fontWeight: "700"
  },
  meRank: {
    color: ui.colors.primary,
    fontSize: 17,
    fontVariant: ["tabular-nums"],
    fontWeight: "700"
  },
  meRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12
  },
  moveCell: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
    textAlign: "center",
    width: 56
  },
  moveHeaderCell: {
    width: 56
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
  // Centred (not right-aligned) so the value sits under the centred "Points"
  // header - a fixed column width keeps this stable regardless of how long
  // the player name in the flex-1 column next to it grows.
  pointsCell: {
    alignItems: "center",
    width: 72
  },
  pointsHeaderCell: {
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
    borderBottomColor: ui.colors.border,
    borderBottomWidth: 1,
    minHeight: 48,
    paddingHorizontal: 4,
    paddingVertical: 8
  },
  rowChevron: {
    color: ui.colors.faint,
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 4
  },
  rowCurrentUser: {
    backgroundColor: ui.colors.accentSoft
  },
  rowInner: {
    alignItems: "center",
    flexDirection: "row"
  },
  rowLast: {
    borderBottomWidth: 0
  },
  search: {
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.small,
    borderWidth: 1,
    color: ui.colors.ink,
    fontSize: 14,
    minHeight: 40,
    paddingHorizontal: 12
  },
  sectionHeading: {
    color: ui.colors.faint,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  tab: {
    alignItems: "center",
    borderRadius: ui.radius.small,
    flex: 1,
    minHeight: 32,
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
    padding: 3
  },
  tabText: {
    color: ui.colors.muted,
    fontSize: 12,
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
