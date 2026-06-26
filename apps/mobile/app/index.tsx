import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppShell } from "../components/AppShell";
import { InfoCard } from "../components/InfoCard";
import { activeAppConfig } from "../lib/appConfig";

export default function HomeScreen() {
  return (
    <AppShell
      title="Home"
      subtitle="A lightweight first pass at the shared tipping app shell."
    >
      <InfoCard title={`Welcome to ${activeAppConfig.appName}`} meta="MVP shell">
        <Text style={styles.copy}>
          Browse sample races, inspect markets, and check the leaderboard
          foundation. Tip submission comes later.
        </Text>
      </InfoCard>

      <View style={styles.actions}>
        <Link href="/races" asChild>
          <Pressable
            style={[
              styles.primaryButton,
              { backgroundColor: activeAppConfig.theme.primaryColor }
            ]}
          >
            <Text style={styles.primaryButtonText}>View races</Text>
          </Pressable>
        </Link>
        <Link href="/leaderboard" asChild>
          <Pressable style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Leaderboard</Text>
          </Pressable>
        </Link>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 10
  },
  copy: {
    color: "#555555",
    fontSize: 15,
    lineHeight: 22
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "800"
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#111111",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  secondaryButtonText: {
    color: "#111111",
    fontWeight: "800"
  }
});
