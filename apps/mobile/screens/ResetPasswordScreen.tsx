import { updatePassword } from "@tipping-suite/supabase-client";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useAuth } from "../auth/useAuth";
import { authStyles as styles } from "./authStyles";

export function ResetPasswordScreen() {
  const router = useRouter();
  const { finishPasswordRecovery, user } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await updatePassword(password);
      finishPasswordRecovery();
      router.replace("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update the password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.title}>Choose a new password</Text>
        <Text style={styles.copy}>
          {user ? "Enter a new password for your account." : "Open this screen from the recovery link in your email."}
        </Text>
        <View style={styles.field}>
          <Text style={styles.label}>New password</Text>
          <TextInput autoCapitalize="none" autoComplete="new-password" onChangeText={setPassword} secureTextEntry style={styles.input} value={password} />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable disabled={loading || !user || password.length < 8} onPress={submit} style={[styles.button, loading && styles.buttonDisabled]}>
          <Text style={styles.buttonText}>{loading ? "Updating…" : "Update password"}</Text>
        </Pressable>
        {!user ? (
          <Pressable onPress={() => router.replace("/login")}>
            <Text style={styles.link}>Back to sign in</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}
