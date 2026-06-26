import { createClient } from "@supabase/supabase-js";

declare const process: {
  env?: Record<string, string | undefined>;
};

export type SupabaseConfig = {
  url: string;
  anonKey: string;
};

export function getSupabaseConfig(): SupabaseConfig {
  const url = process.env?.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env?.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  return { url, anonKey };
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
