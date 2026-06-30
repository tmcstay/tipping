import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppShell } from "../components/AppShell";
import { InfoCard } from "../components/InfoCard";
import { useTdf2026Stages } from "../hooks/useCyclingData";
import { activeAppConfig } from "../lib/appConfig";
import { formatDateTime } from "../lib/formatters";

export default function HomeScreen() {
  const router = useRouter();
  const { race, stages } = useTdf2026Stages();
  const nextStage = stages.data?.find(
    (stage) => new Date(stage.starts_at).getTime() > Date.now()
  ) ?? stages.data?.[0];

  return (
    <AppShell
      title="Tour de France 2026"
      subtitle="Stage-winner tipping for cycling fans."
    >
      <InfoCard title={`Welcome to ${activeAppConfig.appName}`} meta="Cycling">
        <Text style={styles.copy}>
          Pick one rider to win each stage before the stage locks. The current
          rider list is provisional and will be refreshed as teams are confirmed.
        </Text>
      </InfoCard>

      <InfoCard
        title={race.data?.name ?? "Tour de France 2026"}
        meta={race.data?.data_confidence ?? "2026 race"}
      >
        <Text style={styles.copy}>
          {stages.data?.length ?? 21} stages · Spain to Paris
        </Text>
        <Text style={styles.copy}>
          Next stage: {nextStage ? `Stage ${nextStage.stage_number}` : "Loading"}
        </Text>
        <Text style={styles.copy}>
          {nextStage ? formatDateTime(nextStage.starts_at) : "Schedule loading"}
        </Text>
        {race.error || stages.error ? (
          <Text style={styles.note}>
            Connect Supabase and import the 2026 dataset to load live stage data.
          </Text>
        ) : null}
      </InfoCard>

      <InfoCard title="Stage-winner scoring" meta="Rules">
        <Text style={styles.copy}>Winner: 10 points</Text>
        <Text style={styles.copy}>Second: 6 points · Third: 4 points</Text>
        <Text style={styles.copy}>Fourth–tenth: 1 point</Text>
      </InfoCard>

      <View style={styles.actions}>
        <Pressable
          onPress={() => router.push("/stages")}
          style={[
              styles.primaryButton,
              { backgroundColor: activeAppConfig.theme.secondaryColor }
          ]}
        >
          <Text style={styles.primaryButtonText}>View all stages</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/leaderboard")} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Stage leaderboard</Text>
        </Pressable>
      </View>

      <Text style={styles.disclaimer}>
        GrandTour Tips is an independent cycling tipping app and is not an
        official race-organiser product.
      </Text>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
  copy: { color: "#425047", fontSize: 15, lineHeight: 22 },
  disclaimer: { color: "#6B746E", fontSize: 12, lineHeight: 18, textAlign: "center" },
  note: { color: "#8A5A00", fontSize: 13, lineHeight: 19, marginTop: 4 },
  primaryButton: {
    alignItems: "center",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 16
  },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "800" },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#12372A",
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 16
  },
  secondaryButtonText: { color: "#12372A", fontWeight: "800" }
});
