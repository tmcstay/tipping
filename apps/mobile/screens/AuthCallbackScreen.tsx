import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { useAuth } from "../auth/useAuth";
import { authStyles as styles } from "./authStyles";

const REDIRECT_DELAY_MS = 1200;

/**
 * Lands here after a Supabase Auth sign-up confirmation email link
 * (emailRedirectTo -> getAuthRedirectUrl("/auth/callback")). The Supabase
 * client already parses the code/tokens out of the URL on load
 * (detectSessionInUrl, configured in packages/supabase-client/src/client.ts)
 * and updates AuthProvider's session state - this screen just reflects
 * that state back to the user and routes them into the app once ready.
 */
export function AuthCallbackScreen() {
  const router = useRouter();
  const { loading, user } = useAuth();
  const params = useLocalSearchParams<{ error?: string; error_description?: string }>();
  const [redirecting, setRedirecting] = useState(false);

  const urlError = params.error_description ?? params.error ?? null;

  useEffect(() => {
    if (loading || urlError || redirecting) return;
    if (!user) return;

    setRedirecting(true);
    const timer = setTimeout(() => router.replace("/"), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading, redirecting, router, urlError, user]);

  let content: React.ReactNode;
  if (urlError) {
    content = (
      <>
        <Text style={styles.title}>Confirmation failed</Text>
        <Text style={styles.error}>{urlError}</Text>
        <Text style={styles.copy}>The confirmation link may have expired or already been used. Try signing up again, or sign in if your account is already confirmed.</Text>
      </>
    );
  } else if (loading || !user) {
    content = (
      <>
        <Text style={styles.title}>Confirming your account…</Text>
        <ActivityIndicator />
      </>
    );
  } else {
    content = (
      <>
        <Text style={styles.title}>Email confirmed</Text>
        <Text style={styles.success}>Your account is confirmed. Taking you into the app…</Text>
      </>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>{content}</View>
    </ScrollView>
  );
}
