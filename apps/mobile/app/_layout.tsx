import { Stack } from "expo-router";

import { AuthProvider } from "../auth/AuthProvider";
import { useAuth } from "../auth/useAuth";
import { ProtectedRoute } from "../navigation/ProtectedRoute";

export default function RootLayout() {
  return (
    <AuthProvider>
      <ProtectedRoute>
        <RootNavigator />
      </ProtectedRoute>
    </AuthProvider>
  );
}

function RootNavigator() {
  const { isPasswordRecovery, user } = useAuth();

  return (
    <Stack
      screenOptions={{
        headerShown: false
      }}
    >
      {/*
        "auth/callback" and "index" are both registered unconditionally,
        outside every Stack.Protected group - each screen decides its own
        auth-gated content internally (via useAuth()/<Redirect>) rather
        than being swapped in/out by a guard. "index" used to be inside the
        guard={Boolean(user)...} group below, while app/(auth)/index.tsx
        (now removed) was inside the guard={!user...} group - both claimed
        the exact same bare path "/", which produced a real, reproducible
        infinite navigation loop in production (see app/index.tsx's doc
        comment for how this was confirmed and why the fix is structural,
        not a race-condition patch).
      */}
      <Stack.Screen name="auth/callback" />
      <Stack.Screen name="index" />
      <Stack.Protected guard={!user || isPasswordRecovery}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={Boolean(user) && !isPasswordRecovery}>
        <Stack.Screen name="profile" />
        <Stack.Screen name="leaderboard" />
        <Stack.Screen name="results" />
        <Stack.Screen name="my-tips" />
        <Stack.Screen name="overall-jerseys" />
        <Stack.Screen name="stages/index" />
        <Stack.Screen name="stages/[stageId]" />
        <Stack.Screen name="stages/[stageId]/compare" />
        <Stack.Screen name="races/index" />
        <Stack.Screen name="races/[raceId]" />
        <Stack.Screen name="admin/grandtour-stages" />
      </Stack.Protected>
    </Stack>
  );
}
