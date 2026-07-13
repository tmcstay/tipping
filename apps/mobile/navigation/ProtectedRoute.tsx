import { usePathname } from "expo-router";
import type { PropsWithChildren } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAuth } from "../auth/useAuth";
import { isAuthCallbackPathname } from "../lib/authCallbackExperience";
import { authDebugLog } from "../lib/authDebugLog";

export function ProtectedRoute({ children }: PropsWithChildren) {
  const { loading } = useAuth();
  const pathname = usePathname();

  // /auth/callback does its own independent session handling (see
  // AuthCallbackScreen.tsx) and must never be gated behind the global
  // "checking your session" loading state - doing so previously replaced
  // it with this spinner while AuthProvider's initial session check was
  // still in flight, which was one layer of the reported flashing (this
  // spinner swapping in/out against AuthCallbackScreen's own spinner).
  const isAuthCallback = isAuthCallbackPathname(pathname);

  if (loading && !isAuthCallback) {
    authDebugLog("guard", "showing session-check spinner", { pathname, loading });
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
