import { usePathname, useRouter } from "expo-router";
import type { PropsWithChildren } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { activeAppConfig } from "../lib/appConfig";
import { ui } from "./theme";

type AppShellProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
}>;

const navItems = [
  { href: "/", icon: "⌂", label: "Home" },
  { href: "/stages", icon: "✓", label: "Tips" },
  { href: "/leaderboard", icon: "#", label: "Leaders" },
  { href: "/results", icon: "◆", label: "Results" },
  { href: "/profile", icon: "•••", label: "More" }
] as const;

export function AppShell({ children, subtitle, title }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const theme = activeAppConfig.theme;

  return (
    <View style={[styles.page, { backgroundColor: theme.backgroundColor }]}>
      <View style={styles.header}>
        <View style={styles.headerInner}>
          <Text style={styles.appName}>{activeAppConfig.appName}</Text>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.contentInner}>{children}</View>
      </ScrollView>

      <View style={styles.navWrap}>
        <View style={styles.nav}>
          {navItems.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

            return (
              <Pressable
                key={item.href}
                onPress={() => router.push(item.href)}
                style={[styles.navItem, active && { backgroundColor: theme.secondaryColor }]}
              >
                <Text style={[styles.navIcon, active && styles.navTextActive]}>{item.icon}</Text>
                <Text style={[styles.navText, active && styles.navTextActive]}>{item.label}</Text>
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
    color: ui.colors.faint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  content: {
    alignItems: "center",
    padding: 20,
    paddingBottom: 112
  },
  contentInner: { gap: 20, maxWidth: 720, width: "100%" },
  header: {
    backgroundColor: ui.colors.background,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 12
  },
  headerInner: { alignSelf: "center", maxWidth: 720, width: "100%" },
  nav: {
    alignSelf: "center",
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    padding: 6,
    maxWidth: 720,
    width: "100%",
    shadowColor: ui.shadow.shadowColor,
    shadowOffset: ui.shadow.shadowOffset,
    shadowOpacity: 0.06,
    shadowRadius: 12
  },
  navItem: {
    alignItems: "center",
    borderRadius: 14,
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4
  },
  navText: {
    color: ui.colors.muted,
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center"
  },
  navIcon: { color: ui.colors.muted, fontSize: 14, fontWeight: "700", lineHeight: 16 },
  navTextActive: {
    color: "#FFFFFF"
  },
  navWrap: {
    alignSelf: "center",
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
    color: ui.colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4
  },
  title: {
    color: ui.colors.ink,
    fontSize: 22,
    fontWeight: "700",
    marginTop: 4
  }
});
