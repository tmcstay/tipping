import { getSupabaseClient } from "@tipping-suite/supabase-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import {
  decideAuthCallbackAction,
  parseHashParams,
  sanitizeInternalReturnPath
} from "../lib/authCallbackExperience";
import { authStyles as styles } from "./authStyles";

const EXCHANGE_TIMEOUT_MS = 15000;

type ScreenState =
  | { status: "working" }
  | { status: "redirecting" }
  | { status: "error"; message: string };

/**
 * Lands here after a Supabase Auth sign-up confirmation email link
 * (emailRedirectTo -> getAuthRedirectUrl("/auth/callback")). This is the
 * single place in the app that reads callback parameters (code / hash
 * tokens / Supabase error params) and explicitly calls
 * exchangeCodeForSession/setSession - the Supabase client itself never
 * auto-detects a session from the URL (detectSessionInUrl: false in
 * packages/supabase-client/src/client.ts), so there's exactly one handler
 * and no race between "automatic" and "explicit" handling of the same
 * one-time-use code.
 *
 * If the URL carries no code, token pair, or error at all (e.g. someone
 * lands here directly, refreshes after a redirect already happened, or a
 * stale tab is left open on this route), there is nothing to confirm - this
 * screen redirects straight to "/" instead of spinning forever.
 */
export function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
    next?: string;
  }>();
  const [state, setState] = useState<ScreenState>({ status: "working" });
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const hashParams = typeof window !== "undefined" ? parseHashParams(window.location.hash) : {};
    const action = decideAuthCallbackAction({
      code: params.code ?? null,
      error: params.error ?? hashParams.error ?? null,
      error_description: params.error_description ?? hashParams.error_description ?? null,
      access_token: hashParams.access_token ?? null,
      refresh_token: hashParams.refresh_token ?? null
    });
    const safeNext = sanitizeInternalReturnPath(params.next ?? null);

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      setState({
        status: "error",
        message: "This is taking longer than expected. The link may have expired or already been used."
      });
    }, EXCHANGE_TIMEOUT_MS);

    const finish = (result: { error: string | null }) => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timeout);
      if (result.error) {
        setState({ status: "error", message: result.error });
        return;
      }
      setState({ status: "redirecting" });
      router.replace(safeNext);
    };

    switch (action.kind) {
      case "show_error":
        finish({ error: action.message });
        break;
      case "redirect_home":
        finish({ error: null });
        break;
      case "exchange_code":
        void getSupabaseClient()
          .auth.exchangeCodeForSession(action.code)
          .then(({ error }) => finish({ error: error?.message ?? null }))
          .catch((error: unknown) =>
            finish({ error: error instanceof Error ? error.message : "Unable to confirm your account." })
          );
        break;
      case "set_session":
        void getSupabaseClient()
          .auth.setSession({ access_token: action.accessToken, refresh_token: action.refreshToken })
          .then(({ error }) => finish({ error: error?.message ?? null }))
          .catch((error: unknown) =>
            finish({ error: error instanceof Error ? error.message : "Unable to confirm your account." })
          );
        break;
    }

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // Deliberately runs once: the URL's callback params are consumed exactly
    // once (a PKCE code and recovery hash tokens are single-use).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.status === "error") {
    return (
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>Confirmation failed</Text>
          <Text style={styles.error}>{state.message}</Text>
          <Text style={styles.copy}>
            The confirmation link may have expired or already been used. Try signing up again, or sign in if your
            account is already confirmed.
          </Text>
          <Pressable onPress={() => router.replace("/login")} style={styles.button}>
            <Text style={styles.buttonText}>Back to sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.title}>
          {state.status === "redirecting" ? "Taking you into the app…" : "Confirming your account…"}
        </Text>
        <ActivityIndicator />
      </View>
    </ScrollView>
  );
}
