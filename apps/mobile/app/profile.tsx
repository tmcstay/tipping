import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput } from "react-native";
import {
  signOut,
  updateCurrentUserProfile
} from "@tipping-suite/supabase-client";

import { useAuth } from "../auth/useAuth";
import { AppShell } from "../components/AppShell";
import { InfoCard } from "../components/InfoCard";
import { ui } from "../components/theme";
import { useGrandTourAdminAccess } from "../hooks/useGrandTourAdmin";
import { activeAppConfig } from "../lib/appConfig";
import { toSafeErrorMessage } from "../lib/errorMessage";

export default function ProfileScreen() {
  const { profile, profileError, refreshProfile, user } = useAuth();
  const router = useRouter();
  const adminAccess = useGrandTourAdminAccess();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const logOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      // Always land on sign-in, even if signOut() itself threw - never
      // leave the user on a protected screen or on /auth/callback.
      router.replace("/login");
      setSigningOut(false);
    }
  };

  useEffect(() => {
    setFirstName(profile?.first_name ?? "");
    setLastName(profile?.last_name ?? "");
    setDisplayName(profile?.display_name ?? "");
  }, [profile?.first_name, profile?.last_name, profile?.display_name]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await updateCurrentUserProfile({ displayName, firstName, lastName });
      await refreshProfile();
      setMessage("Profile saved.");
    } catch (error) {
      setMessage(toSafeErrorMessage(error, "Unable to save your profile."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell title="Profile" subtitle="Your GrandTour Tips account.">
      <InfoCard title="Account" meta={activeAppConfig.appName}>
        <Text style={styles.label}>First name</Text>
        <TextInput onChangeText={setFirstName} style={styles.input} value={firstName} />
        <Text style={styles.label}>Last name</Text>
        <TextInput onChangeText={setLastName} style={styles.input} value={lastName} />
        <Text style={styles.label}>Display name</Text>
        <TextInput onChangeText={setDisplayName} style={styles.input} value={displayName} />
        <Text style={styles.label}>Email</Text>
        <Text style={styles.copy}>{profile?.email ?? user?.email}</Text>
        {profileError ? <Text style={styles.error}>{toSafeErrorMessage(profileError)}</Text> : null}
        {message ? <Text style={styles.copy}>{message}</Text> : null}
        <Pressable disabled={saving || !displayName.trim()} onPress={save} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{saving ? "Saving…" : "Save profile"}</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/my-tips")} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>My Tips & score history</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/riders")} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Rider directory & favourites</Text>
        </Pressable>
        <Pressable disabled={signingOut} onPress={() => void logOut()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{signingOut ? "Logging out…" : "Log out"}</Text>
        </Pressable>
        {adminAccess.data ? (
          <Pressable
            onPress={() => router.push("/admin/grandtour-stages")}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>GrandTour stage review (admin)</Text>
          </Pressable>
        ) : null}
      </InfoCard>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  copy: {
    color: ui.colors.muted,
    fontSize: 15,
    lineHeight: 21
  },
  error: { color: ui.colors.danger, fontSize: 14 },
  input: { borderColor: ui.colors.border, borderRadius: 8, borderWidth: 1, color: ui.colors.ink, fontSize: 16, minHeight: 46, paddingHorizontal: 12 },
  label: { color: ui.colors.muted, fontSize: 13, fontWeight: "700", marginTop: 8 },
  primaryButton: { alignItems: "center", backgroundColor: ui.colors.primary, borderRadius: 9, marginTop: 10, minHeight: 48, justifyContent: "center" },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "700" },
  secondaryButton: { alignItems: "center", borderColor: ui.colors.primary, borderRadius: 9, borderWidth: 1, minHeight: 48, justifyContent: "center" },
  secondaryButtonText: { color: ui.colors.primary, fontWeight: "700" }
});
