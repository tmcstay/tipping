import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { listLeaderboardForApp } from "@tipping-suite/supabase-client";

import { AppShell } from "../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../components/DataState";
import { InfoCard } from "../components/InfoCard";
import { useAsyncData } from "../hooks/useAsyncData";
import { activeAppConfig } from "../lib/appConfig";

export default function LeaderboardScreen() {
  const loadLeaderboard = useCallback(
    () => listLeaderboardForApp(activeAppConfig.appKey),
    []
  );
  const { data: rows, error, loading, reload } = useAsyncData(loadLeaderboard);

  return (
    <AppShell title="Leaderboard" subtitle="Public leaderboard foundation.">
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {!loading && !error && rows?.length === 0 ? (
        <EmptyState message="No leaderboard rows yet. Scores will appear after results are entered." />
      ) : null}
      {!loading &&
        !error &&
        rows?.map((row, index) => (
          <InfoCard
            title={row.profiles?.display_name ?? "Unnamed tipper"}
            meta={`Rank ${row.rank ?? index + 1}`}
            key={row.id}
          >
            <View style={styles.row}>
              <Text style={styles.points}>{row.total_points} pts</Text>
              <Text style={styles.copy}>{row.tips_count} tips</Text>
            </View>
          </InfoCard>
        ))}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  copy: {
    color: "#555555",
    fontSize: 15
  },
  points: {
    color: "#111111",
    fontSize: 18,
    fontWeight: "800"
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  }
});
