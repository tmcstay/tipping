declare const process: {
  env: Record<string, string | undefined>;
};

declare const __DEV__: boolean;

const LOCALHOST_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

function isDev(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

/**
 * The app's own web origin, used to build Supabase Auth redirect URLs
 * (email confirmation, password reset). Preview-deployment Auth links are
 * deliberately NOT supported here - every environment (including Vercel
 * previews) resolves to the single configured EXPO_PUBLIC_APP_URL, which in
 * practice means production, so Auth email links always land on a stable,
 * allow-listed domain. See docs/deployment.md.
 */
export function getAppOrigin(): string {
  const configured = process.env.EXPO_PUBLIC_APP_URL?.trim();

  if (configured) {
    const origin = configured.replace(/\/+$/, "");
    if (!isDev() && LOCALHOST_ORIGIN_PATTERN.test(origin)) {
      throw new Error(
        "[auth redirect] EXPO_PUBLIC_APP_URL resolves to a localhost origin in a non-development build. " +
          "Set EXPO_PUBLIC_APP_URL to the deployed app's origin (e.g. https://your-app.vercel.app) - " +
          "never leave it pointed at localhost outside local development, or Auth email links will be broken for real users."
      );
    }
    return origin;
  }

  if (isDev()) {
    return "http://localhost:8081";
  }

  throw new Error(
    "[auth redirect] EXPO_PUBLIC_APP_URL is not set. Production/web builds must set EXPO_PUBLIC_APP_URL " +
      "to the deployed app's origin (e.g. https://your-app.vercel.app) so Auth email links (sign-up " +
      "confirmation, password reset) do not silently fall back to localhost."
  );
}

/**
 * Builds a full Auth redirect URL from the app's origin plus a path, e.g.
 * getAuthRedirectUrl("/auth/callback") -> "https://your-app.vercel.app/auth/callback".
 * Duplicate slashes between origin and path are always collapsed to exactly one.
 */
export function getAuthRedirectUrl(path: string): string {
  const origin = getAppOrigin();
  const normalizedPath = `/${path.replace(/^\/+/, "")}`;
  return `${origin}${normalizedPath}`;
}
