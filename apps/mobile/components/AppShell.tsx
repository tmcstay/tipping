import { usePathname, useRouter } from "expo-router";
import type { PropsWithChildren } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { activeAppConfig } from "../lib/appConfig";
import { useGrandTourTipEntryAvailability } from "../hooks/useGrandTourTips";

type AppShellProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
}>;

const navItems = [
  { href: "/", label: "Home" },
  { href: "/stages", label: "Stages" },
  { href: "/overall-jerseys", label: "Jerseys" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/profile", label: "Profile" }
] as const;

export function AppShell({ children, subtitle, title }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const theme = activeAppConfig.theme;
  const tipEntryAvailability = useGrandTourTipEntryAvailability();
  const visibleNavItems = navItems.filter(
    (item) => item.href !== "/overall-jerseys" || tipEntryAvailability.data === true
  );

  return (
    <View style={[styles.page, { backgroundColor: theme.backgroundColor }]}>
      <View style={[styles.header, { borderBottomColor: theme.primaryColor }]}>
        <Text style={styles.appName}>{activeAppConfig.appName}</Text>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>

      <View style={styles.nav}>
        {visibleNavItems.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <Pressable
              key={item.href}
              onPress={() => router.push(item.href)}
              style={[
                styles.navItem,
                active && { backgroundColor: theme.primaryColor }
              ]}
            >
              <Text style={[styles.navText, active && styles.navTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  appName: {
    color: "#666666",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  content: {
    gap: 12,
    padding: 16,
    paddingBottom: 96
  },
  header: {
    borderBottomWidth: 3,
    padding: 16,
    paddingTop: 28
  },
  nav: {
    backgroundColor: "#111111",
    bottom: 0,
    flexDirection: "row",
    gap: 8,
    left: 0,
    padding: 12,
    position: "absolute",
    right: 0
  },
  navItem: {
    alignItems: "center",
    borderRadius: 8,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 8
  },
  navText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center"
  },
  navTextActive: {
    color: "#111111"
  },
  page: {
    flex: 1
  },
  subtitle: {
    color: "#666666",
    fontSize: 15,
    lineHeight: 21,
    marginTop: 6
  },
  title: {
    color: "#111111",
    fontSize: 28,
    fontWeight: "800",
    marginTop: 6
  }
});
