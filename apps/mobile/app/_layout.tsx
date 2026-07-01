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
      <Stack.Protected guard={!user || isPasswordRecovery}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={Boolean(user) && !isPasswordRecovery}>
        <Stack.Screen name="index" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="leaderboard" />
        <Stack.Screen name="stages" />
        <Stack.Screen name="races" />
      </Stack.Protected>
    </Stack>
  );
}
