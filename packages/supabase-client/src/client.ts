import { createClient } from "@supabase/supabase-js";

declare const process: {
  env: Record<string, string | undefined>;
};

declare const __DEV__: boolean;

// Expo replaces direct process.env.EXPO_PUBLIC_* references at bundle time.
// Keep these as dot-notation references; optional chaining or bracket access
// prevents Expo from embedding the Codemagic values in the native bundle.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

if (typeof __DEV__ !== "undefined" && __DEV__) {
  console.log("[Supabase config]", {
    urlPresent: Boolean(supabaseUrl),
    anonKeyPresent: Boolean(supabaseAnonKey),
    anonKeyLength: supabaseAnonKey?.length ?? 0
  });
}

export type SupabaseConfig = {
  url: string;
  anonKey: string;
};

export function getSupabaseConfig(): SupabaseConfig {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  return { url: supabaseUrl, anonKey: supabaseAnonKey };
}

export function createPublicSupabaseClient(config = getSupabaseConfig()) {
  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

let cachedClient: ReturnType<typeof createPublicSupabaseClient> | null = null;

export function getSupabaseClient() {
  cachedClient ??= createPublicSupabaseClient();
  return cachedClient;
}
