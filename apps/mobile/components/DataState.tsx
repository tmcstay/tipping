import { Pressable, StyleSheet, Text, View } from "react-native";

type DataStateProps = {
  error?: string | null;
  loading?: boolean;
  onRetry?: () => void;
};

export function LoadingState() {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Loading</Text>
      <Text style={styles.copy}>Fetching the latest sample data.</Text>
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
    backgroundColor: "#111111",
    borderRadius: 8,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700"
  },
  copy: {
    color: "#666666",
    fontSize: 15,
    lineHeight: 21,
    marginTop: 4
  },
  panel: {
    backgroundColor: "#F4F4F4",
    borderRadius: 8,
    padding: 16
  },
  title: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "800"
  }
});
