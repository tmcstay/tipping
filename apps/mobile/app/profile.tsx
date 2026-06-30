import { useCallback } from "react";
import { StyleSheet, Text } from "react-native";
import { getCurrentUser } from "@tipping-suite/supabase-client";

import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState } from "../components/DataState";
import { InfoCard } from "../components/InfoCard";
import { useAsyncData } from "../hooks/useAsyncData";
import { activeAppConfig } from "../lib/appConfig";

export default function ProfileScreen() {
  const loadUser = useCallback(() => getCurrentUser(), []);
  const { data: user, error, loading, reload } = useAsyncData(loadUser);

  return (
    <AppShell title="Profile" subtitle="Your GrandTour Tips account.">
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {!loading && !error ? (
        <InfoCard title={user?.email ?? "Not signed in"} meta={activeAppConfig.appName}>
          <Text style={styles.copy}>
            Sign in to save stage-winner tips. Display-name editing and richer
            account controls remain an MVP follow-up.
          </Text>
        </InfoCard>
      ) : null}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  copy: {
    color: "#555555",
    fontSize: 15,
    lineHeight: 21
  }
});
