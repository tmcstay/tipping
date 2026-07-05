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

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Nothing here yet</Text>
      <Text style={styles.copy}>{message}</Text>
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
  stateCopy: { flex: 1 }
});
