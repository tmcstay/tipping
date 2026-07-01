import type { PropsWithChildren } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAuth } from "../auth/useAuth";

export function ProtectedRoute({ children }: PropsWithChildren) {
  const { loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator accessibilityLabel="Checking your session" size="large" />
      </View>
    );
  }

  return children;
}

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  }
});
