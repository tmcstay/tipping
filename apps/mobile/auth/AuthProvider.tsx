import {
  getCurrentSession,
  getCurrentUserProfile,
  getSupabaseClient,
  type UserProfile
} from "@tipping-suite/supabase-client";
import type { Session, User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import {
  AppState,
  type AppStateStatus,
  Platform
} from "react-native";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import { authDebugLog } from "../lib/authDebugLog";

export type AuthContextValue = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  profileError: Error | null;
  refreshProfile: () => Promise<void>;
  isPasswordRecovery: boolean;
  finishPasswordRecovery: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState<Error | null>(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  const loadProfile = useCallback(async (userId?: string) => {
    if (!userId) {
      setProfile(null);
      setProfileError(null);
      return;
    }

    try {
      setProfile(await getCurrentUserProfile(userId));
      setProfileError(null);
    } catch (error) {
      setProfile(null);
      setProfileError(error instanceof Error ? error : new Error(String(error)));
    }
  }, []);

  const refreshProfile = useCallback(
    async () => loadProfile(session?.user.id),
    [loadProfile, session?.user.id]
  );

  useEffect(() => {
    let active = true;

    void getCurrentSession()
      .then(async (initialSession) => {
        if (!active) return;
        authDebugLog("provider", "initial getSession resolved", { hasSession: Boolean(initialSession) });
        setSession(initialSession);
        await loadProfile(initialSession?.user.id);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data } = getSupabaseClient().auth.onAuthStateChange(
      (event, nextSession) => {
        if (!active) return;
        authDebugLog("provider", "onAuthStateChange", { event, hasSession: Boolean(nextSession) });
        if (event === "PASSWORD_RECOVERY") setIsPasswordRecovery(true);
        if (event === "SIGNED_OUT") setIsPasswordRecovery(false);
        setSession(nextSession);
        setLoading(false);
        // Keep the auth callback synchronous; schedule the database request after it.
        setTimeout(() => {
          if (active) void loadProfile(nextSession?.user.id);
        }, 0);
      }
    );

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [loadProfile]);

  useEffect(() => {
    const handleRecoveryUrl = async (url: string | null) => {
      if (!url || !url.includes("reset-password")) return;

      setIsPasswordRecovery(true);
      const separator = url.includes("?") ? "&" : "?";
      const normalizedUrl = url.replace("#", separator);
      const params = new URL(normalizedUrl).searchParams;
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error } = await getSupabaseClient().auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });
        if (error) setProfileError(error);
      }
    };

    void Linking.getInitialURL().then(handleRecoveryUrl);
    const subscription = Linking.addEventListener("url", ({ url }) => {
      void handleRecoveryUrl(url);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const handleAppState = (state: AppStateStatus) => {
      if (state === "active") getSupabaseClient().auth.startAutoRefresh();
      else getSupabaseClient().auth.stopAutoRefresh();
    };

    const subscription = AppState.addEventListener("change", handleAppState);
    handleAppState(AppState.currentState);
    return () => subscription.remove();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      finishPasswordRecovery: () => setIsPasswordRecovery(false),
      isPasswordRecovery,
      profile,
      profileError,
      refreshProfile,
      session,
      user: session?.user ?? null
    }),
    [isPasswordRecovery, loading, profile, profileError, refreshProfile, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
