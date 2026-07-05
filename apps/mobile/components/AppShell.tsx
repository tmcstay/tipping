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
  { href: "/", icon: "⌂", label: "Dashboard" },
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

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><View style={styles.contentInner}>{children}</View></ScrollView>

      <View style={styles.navWrap}>
        <View style={styles.nav}>
          {navItems.map((item) => {
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
                <Text style={[styles.navIcon, active && styles.navTextActive]}>{item.icon}</Text>
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
    alignItems: "center",
    padding: 16,
    paddingBottom: 104
  },
  contentInner: { gap: 14, maxWidth: 760, width: "100%" },
  header: {
    backgroundColor: ui.colors.surface,
    borderBottomColor: ui.colors.border,
    borderBottomWidth: 1,
    padding: 16,
    paddingTop: 30
  },
  headerInner: { alignSelf: "center", maxWidth: 760, width: "100%" },
  nav: {
    alignSelf: "center",
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    padding: 6,
    maxWidth: 760,
    width: "100%",
    ...ui.shadow
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
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center"
  },
  navIcon: { color: ui.colors.muted, fontSize: 15, fontWeight: "900", lineHeight: 17 },
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
