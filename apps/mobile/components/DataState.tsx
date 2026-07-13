import { Pressable, StyleSheet, Text, View } from "react-native";

import { ui } from "./theme";

type DataStateProps = {
  error?: string | null;
  loading?: boolean;
  onRetry?: () => void;
};

export function LoadingState() {
  return (
    <View style={styles.panel}>
      <View style={styles.loadingDot} />
      <View style={styles.stateCopy}><Text style={styles.title}>Loading</Text><Text style={styles.copy}>Fetching the latest cycling data.</Text></View>
    </View>
  );
}

export function ErrorState({ error, onRetry }: DataStateProps) {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Could not load data</Text>
      <Text style={styles.copy}>{error ?? "Please try again."}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.button}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({ message, title }: { message: string; title?: string }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{title ?? "Nothing here yet"}</Text>
      <Text style={styles.copy}>{message}</Text>
    </View>
  );
}

/**
 * A loading placeholder sized to match a real InfoCard (same radius/border/
 * padding/shadow), so the layout never jumps once real content replaces it.
 * `lines` controls how many body placeholder bars render below the title
 * bar - tune per section to roughly match that section's real content
 * height.
 */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <View style={styles.panel}>
      <View style={styles.skeletonMetaBar} />
      <View style={styles.skeletonTitleBar} />
      {Array.from({ length: lines }).map((_, index) => (
        <View key={index} style={[styles.skeletonLineBar, index === lines - 1 && styles.skeletonLineBarShort]} />
      ))}
    </View>
  );
}

/** Matches the dashboard's 3-up DashboardStatCard row so the stat grid doesn't jump on load. */
export function SkeletonStatGrid() {
  return (
    <View style={styles.skeletonStatGrid}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.skeletonStatCard}>
          <View style={styles.skeletonLabelBar} />
          <View style={styles.skeletonValueBar} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "flex-start",
    backgroundColor: ui.colors.primary,
    borderRadius: ui.radius.medium,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700"
  },
  copy: {
    color: ui.colors.muted,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 4
  },
  panel: {
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.large,
    borderWidth: 1,
    padding: 16,
    ...ui.shadow
  },
  title: {
    color: ui.colors.ink,
    fontSize: 16,
    fontWeight: "800"
  },
  loadingDot: { backgroundColor: ui.colors.accent, borderRadius: 8, height: 12, marginBottom: 8, width: 12 },
  stateCopy: { flex: 1 },
  skeletonLabelBar: { backgroundColor: ui.colors.border, borderRadius: 4, height: 10, width: "60%" },
  skeletonLineBar: { backgroundColor: ui.colors.border, borderRadius: 4, height: 12, marginTop: 10, width: "100%" },
  skeletonLineBarShort: { width: "70%" },
  skeletonMetaBar: { backgroundColor: ui.colors.border, borderRadius: 4, height: 10, width: "35%" },
  skeletonStatCard: {
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.large,
    borderWidth: 1,
    flex: 1,
    gap: 10,
    minHeight: 96,
    minWidth: 136,
    padding: 14
  },
  skeletonStatGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  skeletonTitleBar: { backgroundColor: ui.colors.border, borderRadius: 4, height: 18, marginTop: 8, width: "80%" },
  skeletonValueBar: { backgroundColor: ui.colors.border, borderRadius: 4, height: 22, width: "40%" }
});
