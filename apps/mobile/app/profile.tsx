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
import { useGrandTourAdminAccess } from "../hooks/useGrandTourAdmin";
import { activeAppConfig } from "../lib/appConfig";

export default function ProfileScreen() {
  const { profile, profileError, refreshProfile, user } = useAuth();
  const router = useRouter();
  const adminAccess = useGrandTourAdminAccess();
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.display_name ?? "");
  }, [profile?.display_name]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await updateCurrentUserProfile({ displayName });
      await refreshProfile();
      setMessage("Profile saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save your profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell title="Profile" subtitle="Your GrandTour Tips account.">
      <InfoCard title={profile?.display_name || user?.email || "Profile"} meta={activeAppConfig.appName}>
        <Text style={styles.label}>Email</Text>
        <Text style={styles.copy}>{profile?.email ?? user?.email}</Text>
        <Text style={styles.label}>Display name</Text>
        <TextInput onChangeText={setDisplayName} style={styles.input} value={displayName} />
        {profileError ? <Text style={styles.error}>{profileError.message}</Text> : null}
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
        <Pressable onPress={() => void signOut()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Log out</Text>
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
    color: "#555555",
    fontSize: 15,
    lineHeight: 21
  },
  error: { color: "#A12622", fontSize: 14 },
  input: { borderColor: "#AAB5AE", borderRadius: 8, borderWidth: 1, fontSize: 16, minHeight: 46, paddingHorizontal: 12 },
  label: { color: "#25372C", fontSize: 13, fontWeight: "800", marginTop: 8 },
  primaryButton: { alignItems: "center", backgroundColor: "#12372A", borderRadius: 9, marginTop: 10, minHeight: 48, justifyContent: "center" },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "800" },
  secondaryButton: { alignItems: "center", borderColor: "#12372A", borderRadius: 9, borderWidth: 1, minHeight: 48, justifyContent: "center" },
  secondaryButtonText: { color: "#12372A", fontWeight: "800" }
});
