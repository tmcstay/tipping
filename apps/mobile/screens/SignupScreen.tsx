import { signUpWithPassword } from "@tipping-suite/supabase-client";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { authStyles as styles } from "./authStyles";

export function SignupScreen() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await signUpWithPassword({ displayName, email, password });
      if (!result.session) {
        setMessage("Account created. Check your email to confirm it, then sign in.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create the account.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.copy}>Your display name can be changed later.</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Display name (optional)</Text>
          <TextInput autoComplete="name" onChangeText={setDisplayName} style={styles.input} value={displayName} />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} style={styles.input} value={email} />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput autoCapitalize="none" autoComplete="new-password" onChangeText={setPassword} secureTextEntry style={styles.input} value={password} />
          <Text style={styles.copy}>Use at least 8 characters.</Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {message ? <Text style={styles.success}>{message}</Text> : null}
        <Pressable
          disabled={loading || !email.trim() || password.length < 8}
          onPress={submit}
          style={[styles.button, loading && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>{loading ? "Creating…" : "Create account"}</Text>
        </Pressable>
        <Pressable onPress={() => router.replace("/login")}>
          <Text style={styles.link}>Back to sign in</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
