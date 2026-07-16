import { usePathname, useRouter } from "expo-router";
import type { PropsWithChildren } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { activeAppConfig } from "../lib/appConfig";
import { getRaceHeadingAccent, ui } from "./theme";

type AppShellProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  /**
   * The grand tour's already-formatted display name (e.g. "Tour de France
   * ’26" - build it with lib/grandTourDisplay.ts's formatGrandTourName,
   * never a raw `grand_tours.name` value). Shown as a small eyebrow line
   * above the title - the one place this renders as visible text, reused
   * by every screen via this shared shell rather than each screen
   * rendering its own copy. Omit for screens with no specific race
   * context.
   *
   * The eyebrow and title text are always the app's normal ink colour,
   * never race-accent-coloured - a genuinely bright race colour (e.g. the
   * real Tour de France maillot jaune yellow) fails WCAG text-contrast
   * against this app's light background, so getRaceHeadingAccent's colour
   * is reserved for the underline bar only, which has no text-contrast
   * requirement. See raceAccent.ts.
   */
  raceName?: string;
}>;

const navItems = [
  { href: "/", icon: "⌂", label: "Home" },
  { href: "/stages", icon: "✓", label: "Tips" },
  { href: "/leaderboard", icon: "#", label: "Leaders" },
  { href: "/results", icon: "◆", label: "Results" },
  { href: "/profile", icon: "•••", label: "More" }
] as const;

export function AppShell({ children, raceName, subtitle, title }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const theme = activeAppConfig.theme;
  const raceAccent = raceName ? getRaceHeadingAccent(raceName) : null;

  return (
    <View style={[styles.page, { backgroundColor: theme.backgroundColor }]}>
      <View style={styles.header}>
        <View style={styles.headerInner}>
          {raceName ? <Text style={styles.raceEyebrow}>{raceName}</Text> : null}
          <Text style={styles.title}>{title}</Text>
          {raceAccent ? <View style={[styles.raceUnderline, { backgroundColor: raceAccent }]} /> : null}
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
  raceEyebrow: {
    color: ui.colors.ink,
    fontSize: 12,
    fontWeight: "700"
  },
  raceUnderline: {
    borderRadius: ui.radius.pill,
    height: 3,
    marginTop: 6,
    width: 36
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
