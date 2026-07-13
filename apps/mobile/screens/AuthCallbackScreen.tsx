import { getSupabaseClient } from "@tipping-suite/supabase-client";
import { Redirect, useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { useAuth } from "../auth/useAuth";
import {
  decideAuthCallbackAction,
  getAuthCallbackFlowKey,
  parseHashParams,
  sanitizeInternalReturnPath
} from "../lib/authCallbackExperience";
import { authDebugLog } from "../lib/authDebugLog";
import { authStyles as styles } from "./authStyles";

const EXCHANGE_TIMEOUT_MS = 15000;
/**
 * Once the exchange/setSession call itself has succeeded, this is the most
 * we'll wait for AuthProvider's onAuthStateChange listener to reflect the
 * new session in `useAuth()` before navigating anyway. Normally this
 * resolves almost instantly (the same event that updates AuthProvider is
 * part of the exchange call itself) - this is a bounded safety net, not
 * the primary mechanism (see the module doc comment below for why waiting
 * matters at all).
 */
const SESSION_PROPAGATION_TIMEOUT_MS = 5000;

type ScreenState =
  | { status: "working" }
  | { status: "awaiting_session" }
  | { status: "redirecting"; destination: string }
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
 * Three production bugs, all fixed here:
 *
 * 1. **"Attempted to navigate before mounting the Root Layout component."**
 *    A real, reproducible error (confirmed with a headless browser against
 *    production): an imperative `router.replace(...)` call inside a
 *    `useEffect` that can fire on this screen's very first mount (the
 *    `redirect_home` case - no callback params at all) raced Expo Router's
 *    own navigator-ready timing. This screen now never calls
 *    `router.replace` imperatively - it sets `{status: "redirecting",
 *    destination}` and renders a declarative `<Redirect href={destination}
 *    />` instead, which is Expo Router's own documented-safe mechanism for
 *    exactly this "redirect once ready" situation.
 * 2. **Competing redirects.** A successful exchange makes AuthProvider's
 *    session update, which flips the root `Stack.Protected` guards
 *    (app/_layout.tsx) - and per Expo Router's own docs, a guard flip
 *    mutates navigation history and can redirect on its own, at the same
 *    moment this screen's own redirect was about to fire. Fixed by making
 *    this screen the single owner of the decision: after a successful
 *    exchange it moves to "awaiting_session" and only renders its own
 *    `<Redirect>` once `useAuth()`'s `user` has actually caught up
 *    (bounded by SESSION_PROPAGATION_TIMEOUT_MS as a fallback) - by the
 *    time it redirects, the guard has already settled, so there's nothing
 *    left to race.
 * 3. **Remount re-triggering the exchange.** If this screen is remounted
 *    while an exchange is in flight (the guard flip above forcing a
 *    remount, or React Strict Mode's dev double-invoke), a fresh
 *    per-mount ref would previously start a *second* exchange call against
 *    the same, now-being-or-already-consumed one-time-use code, which
 *    fails and can strand the flow in an error/spinner cycle. Fixed with a
 *    module-level (not component-state) in-flight/completed registry keyed
 *    by `getAuthCallbackFlowKey` - every mount for the same callback
 *    attempt shares one Supabase call, never issues a second one, and only
 *    the currently-mounted instance acts on the shared result.
 *
 * If the URL carries no code, token pair, or error at all (e.g. someone
 * lands here directly, refreshes after a redirect already happened, or a
 * stale tab is left open on this route), there is nothing to confirm and
 * nothing to wait for - this screen redirects straight to "/" immediately
 * instead of spinning forever.
 */

type FlowResult = { error: string | null };

const flowRegistry = new Map<string, Promise<FlowResult>>();

export function AuthCallbackScreen() {
  const pathname = usePathname();
  const { loading: authLoading, user } = useAuth();
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
    next?: string;
  }>();
  const [state, setState] = useState<ScreenState>({ status: "working" });

  // Phase 1: decide the action once per mount and process it (reusing any
  // in-flight/completed attempt for the same callback signature - see the
  // module doc comment above). Never issues a second Supabase call for the
  // same code/token pair, even across remounts.
  useEffect(() => {
    const hashParams = typeof window !== "undefined" ? parseHashParams(window.location.hash) : {};
    const paramNames = Object.keys({ ...params, ...hashParams }).filter((key) => params[key as keyof typeof params] || hashParams[key]);
    authDebugLog("callback", "mounted", { pathname, paramNames });

    const action = decideAuthCallbackAction({
      code: params.code ?? null,
      error: params.error ?? hashParams.error ?? null,
      error_description: params.error_description ?? hashParams.error_description ?? null,
      access_token: hashParams.access_token ?? null,
      refresh_token: hashParams.refresh_token ?? null
    });
    const safeNext = sanitizeInternalReturnPath(params.next ?? null);
    const flowKey = getAuthCallbackFlowKey(action);

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      setState({
        status: "error",
        message: "This is taking longer than expected. The link may have expired or already been used."
      });
    }, EXCHANGE_TIMEOUT_MS);

    const settle = (result: FlowResult) => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timeout);
      if (result.error) {
        authDebugLog("callback", "exchange failed", { message: result.error });
        setState({ status: "error", message: result.error });
        return;
      }
      authDebugLog("callback", "exchange succeeded, awaiting session propagation", { destination: safeNext });
      setState({ status: "awaiting_session" });
    };

    switch (action.kind) {
      case "show_error":
        settle({ error: action.message });
        break;
      case "redirect_home":
        clearTimeout(timeout);
        cancelled = true;
        authDebugLog("callback", "redirect", { source: "no-callback-params", destination: safeNext });
        setState({ status: "redirecting", destination: safeNext });
        break;
      case "exchange_code":
      case "set_session": {
        let attempt = flowRegistry.get(flowKey);
        if (!attempt) {
          attempt = action.kind === "exchange_code"
            ? getSupabaseClient().auth.exchangeCodeForSession(action.code).then(({ error }) => ({ error: error?.message ?? null }))
            : getSupabaseClient().auth.setSession({ access_token: action.accessToken, refresh_token: action.refreshToken }).then(({ error }) => ({ error: error?.message ?? null }));
          flowRegistry.set(flowKey, attempt);
        }
        void attempt
          .then(settle)
          .catch((error: unknown) => settle({ error: error instanceof Error ? error.message : "Unable to confirm your account." }));
        break;
      }
    }

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // Deliberately runs once per mount: the flow-registry dedup above (not
    // this dependency array) is what protects against duplicate Supabase
    // calls across remounts/Strict Mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 2: once the exchange has succeeded, this is the ONLY place that
  // decides when it's safe to redirect - it waits for AuthProvider's own
  // session state to reflect the new session (so the root Stack.Protected
  // guards have already settled by the time the <Redirect> below renders,
  // instead of racing them) and is the sole owner of that decision.
  useEffect(() => {
    if (state.status !== "awaiting_session") return;

    authDebugLog("callback", "awaiting session propagation", { authLoading, hasUser: Boolean(user) });
    const safeNext = sanitizeInternalReturnPath(params.next ?? null);
    if (!authLoading && user) {
      authDebugLog("callback", "redirect", { source: "session-confirmed", destination: safeNext });
      setState({ status: "redirecting", destination: safeNext });
      return;
    }

    const fallback = setTimeout(() => {
      authDebugLog("callback", "session propagation timed out - redirecting anyway", {});
      setState({ status: "redirecting", destination: safeNext });
    }, SESSION_PROPAGATION_TIMEOUT_MS);
    return () => clearTimeout(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, authLoading, user]);

  if (state.status === "redirecting") {
    return <Redirect href={state.destination} />;
  }

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
          <Pressable
            onPress={() => setState({ status: "redirecting", destination: "/login" })}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Back to sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.title}>Confirming your account…</Text>
        <ActivityIndicator />
      </View>
    </ScrollView>
  );
}
