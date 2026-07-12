import { signOut, updatePassword } from "@tipping-suite/supabase-client";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useAuth } from "../auth/useAuth";
import { authStyles as styles } from "./authStyles";

const MIN_PASSWORD_LENGTH = 8;

export function ResetPasswordScreen() {
  const router = useRouter();
  const { finishPasswordRecovery, user } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const validationError =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH
      ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      : confirmPassword.length > 0 && confirmPassword !== password
        ? "Passwords do not match."
        : null;

  const canSubmit =
    !loading && !success && Boolean(user) && password.length >= MIN_PASSWORD_LENGTH && password === confirmPassword;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      await updatePassword(password);
      setSuccess(true);
      // The recovery link signs the user in via a short-lived recovery
      // session - sign out and send them back to a real sign-in with the
      // new password, rather than silently continuing into the app under
      // that recovery session.
      await signOut();
      finishPasswordRecovery();
      setTimeout(() => router.replace("/login"), 1500);
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
          {user ? "Enter and confirm a new password for your account." : "Open this screen from the recovery link in your email."}
        </Text>
        <View style={styles.field}>
          <Text style={styles.label}>New password</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="new-password"
            editable={!success}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Confirm new password</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="new-password"
            editable={!success}
            onChangeText={setConfirmPassword}
            secureTextEntry
            style={styles.input}
            value={confirmPassword}
          />
        </View>
        {validationError ? <Text style={styles.error}>{validationError}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {success ? (
          <Text style={styles.success}>Password updated. Redirecting you to sign in…</Text>
        ) : (
          <Pressable disabled={!canSubmit} onPress={submit} style={[styles.button, !canSubmit && styles.buttonDisabled]}>
            <Text style={styles.buttonText}>{loading ? "Updating…" : "Update password"}</Text>
          </Pressable>
        )}
        {!user && !success ? (
          <Pressable onPress={() => router.replace("/login")}>
            <Text style={styles.link}>Back to sign in</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}
