import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Database } from "@tipping-suite/shared-types";

declare const process: {
  env: Record<string, string | undefined>;
};

declare const __DEV__: boolean;

// Expo replaces direct process.env.EXPO_PUBLIC_* references at bundle time.
// Keep these as dot-notation references; optional chaining or bracket access
// prevents Expo from embedding the Codemagic values in the native bundle.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabasePublishableKey);

if (typeof __DEV__ !== "undefined" && __DEV__) {
  console.log("[Supabase config]", {
    urlPresent: Boolean(supabaseUrl),
    publishableKeyPresent: Boolean(supabasePublishableKey)
  });
}

export type SupabaseConfig = {
  url: string;
  publishableKey: string;
};

export function getSupabaseConfig(): SupabaseConfig {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  return { url: supabaseUrl, publishableKey: supabasePublishableKey };
}

export function createPublicSupabaseClient(config = getSupabaseConfig()) {
  return createClient<Database>(config.url, config.publishableKey, {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: typeof window !== "undefined"
    }
  });
}

let cachedClient: ReturnType<typeof createPublicSupabaseClient> | null = null;

export function getSupabaseClient() {
  cachedClient ??= createPublicSupabaseClient();
  return cachedClient;
}
