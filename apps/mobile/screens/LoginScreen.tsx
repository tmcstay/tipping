import { signInWithPassword } from "@tipping-suite/supabase-client";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from "react-native";

import { authStyles as styles } from "./authStyles";

export function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPassword(email, password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.copy}>Sign in to make and manage your GrandTour tips.</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onChangeText={setEmail}
              style={styles.input}
              value={email}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="current-password"
              onChangeText={setPassword}
              secureTextEntry
              style={styles.input}
              value={password}
            />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            disabled={loading || !email.trim() || !password}
            onPress={submit}
            style={[styles.button, loading && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>{loading ? "Signing in…" : "Sign in"}</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/forgot-password")}>
            <Text style={styles.link}>Forgot password?</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/signup")}>
            <Text style={styles.link}>Create an account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
