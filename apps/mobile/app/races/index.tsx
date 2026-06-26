import { Link } from "expo-router";
import { useCallback } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { listEventsForApp } from "@tipping-suite/supabase-client";

import { AppShell } from "../../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/DataState";
import { InfoCard } from "../../components/InfoCard";
import { useAsyncData } from "../../hooks/useAsyncData";
import { activeAppConfig } from "../../lib/appConfig";
import { formatDateTime } from "../../lib/formatters";

export default function RaceListScreen() {
  const loadRaces = useCallback(
    () => listEventsForApp(activeAppConfig.appKey),
    []
  );
  const { data: races, error, loading, reload } = useAsyncData(loadRaces);

  return (
    <AppShell title="Race List" subtitle="Events are loaded from Supabase.">
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {!loading && !error && races?.length === 0 ? (
        <EmptyState message="No races are available for this app yet." />
      ) : null}
      {!loading &&
        !error &&
        races?.map((race) => (
          <Link href={`/races/${race.id}`} asChild key={race.id}>
            <Pressable>
              <InfoCard title={race.name} meta={race.status}>
                <Text style={styles.copy}>{race.venue ?? "Venue TBC"}</Text>
                <Text style={styles.copy}>{race.country ?? "Country TBC"}</Text>
                <Text style={styles.lock}>Locks {formatDateTime(race.lock_at)}</Text>
              </InfoCard>
            </Pressable>
          </Link>
        ))}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  copy: {
    color: "#555555",
    fontSize: 15
  },
  lock: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "700"
  }
});
