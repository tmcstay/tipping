/**
 * Temporary, development-only tracing for the auth redirect sequence
 * (AuthProvider's session/auth-state changes, ProtectedRoute's guard
 * decisions, AuthCallbackScreen's own processing/redirects). Gated behind
 * `__DEV__` so nothing is ever printed in production - this exists purely
 * to make a redirect-loop reproducible/diagnosable locally without
 * shipping console noise. Never logs a token/code value, only parameter
 * *names* and booleans, per this codebase's rule against logging secrets.
 */
export function authDebugLog(scope: string, message: string, data?: Record<string, unknown>): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  // eslint-disable-next-line no-console
  console.log(`[auth:${scope}] ${message}`, data ?? "");
}

declare const __DEV__: boolean;
