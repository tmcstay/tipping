import { sendPasswordResetEmail } from "@tipping-suite/supabase-client";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { authStyles as styles } from "./authStyles";

export function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await sendPasswordResetEmail(email, Linking.createURL("/reset-password"));
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send the reset email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.title}>Reset password</Text>
        <Text style={styles.copy}>Enter your account email and we’ll send recovery instructions.</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} style={styles.input} value={email} />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {sent ? <Text style={styles.success}>If that account exists, recovery instructions have been sent.</Text> : null}
        <Pressable disabled={loading || !email.trim()} onPress={submit} style={[styles.button, loading && styles.buttonDisabled]}>
          <Text style={styles.buttonText}>{loading ? "Sending…" : "Send reset email"}</Text>
        </Pressable>
        <Pressable onPress={() => router.replace("/login")}>
          <Text style={styles.link}>Back to sign in</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
