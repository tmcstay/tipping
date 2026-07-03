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
  { href: "/", label: "Dashboard" },
  { href: "/stages", label: "Tips" },
  { href: "/overall-jerseys", label: "Jerseys" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/profile", label: "More" }
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
      <View style={styles.header}>
        <Text style={styles.appName}>{activeAppConfig.appName}</Text>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>{children}</ScrollView>

      <View style={styles.navWrap}>
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
                  active && { backgroundColor: theme.secondaryColor }
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
    </View>
  );
}

const styles = StyleSheet.create({
  appName: {
    color: "#68746D",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase"
  },
  content: {
    gap: 14,
    padding: 16,
    paddingBottom: 104
  },
  header: {
    backgroundColor: "#FFFFFF",
    borderBottomColor: "#E5ECE7",
    borderBottomWidth: 1,
    padding: 16,
    paddingTop: 30
  },
  nav: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DCE6DF",
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    padding: 6,
    shadowColor: "#0F241A",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 16
  },
  navItem: {
    alignItems: "center",
    borderRadius: 16,
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4
  },
  navText: {
    color: "#4D5A52",
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center"
  },
  navTextActive: {
    color: "#FFFFFF"
  },
  navWrap: {
    bottom: 0,
    left: 0,
    padding: 12,
    position: "absolute",
    right: 0
  },
  page: {
    flex: 1
  },
  subtitle: {
    color: "#536159",
    fontSize: 15,
    lineHeight: 21,
    marginTop: 6
  },
  title: {
    color: "#12372A",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.7,
    marginTop: 6
  }
});
