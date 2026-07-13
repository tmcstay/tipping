/**
 * Pure decision logic for the /auth/callback screen. Kept free of
 * React/Supabase/router so it can be unit-tested directly: given whatever
 * query-string and hash-fragment parameters the browser landed with, decide
 * what the screen should do next. The component (AuthCallbackScreen.tsx)
 * is a thin shell that reads the real URL, calls this, and acts on the
 * result (exchangeCodeForSession / setSession / redirect / show error).
 */

export type AuthCallbackParams = {
  code?: string | null;
  error?: string | null;
  error_description?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
};

export type AuthCallbackAction =
  | { kind: "show_error"; message: string }
  | { kind: "exchange_code"; code: string }
  | { kind: "set_session"; accessToken: string; refreshToken: string }
  | { kind: "redirect_home" };

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

/**
 * Decides what /auth/callback should do based on the callback parameters
 * actually present in the URL - never assumes a code/token is present.
 * Supabase Auth error params (?error=...&error_description=...) always win,
 * since a link Supabase itself flagged as failed should never be retried.
 */
export function decideAuthCallbackAction(params: AuthCallbackParams): AuthCallbackAction {
  const errorMessage = firstNonEmpty(params.error_description, params.error);
  if (errorMessage) return { kind: "show_error", message: errorMessage };

  const code = firstNonEmpty(params.code);
  if (code) return { kind: "exchange_code", code };

  const accessToken = firstNonEmpty(params.access_token);
  const refreshToken = firstNonEmpty(params.refresh_token);
  if (accessToken && refreshToken) {
    return { kind: "set_session", accessToken, refreshToken };
  }

  return { kind: "redirect_home" };
}

/** Parses a URL hash fragment (e.g. "#access_token=x&refresh_token=y") into a plain object. */
export function parseHashParams(hash: string): Record<string, string> {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  const result: Record<string, string> = {};
  if (!normalized) return result;

  const search = new URLSearchParams(normalized);
  search.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

const DEFAULT_SAFE_PATH = "/";

function isSafeInternalPath(path: string): boolean {
  if (path.length === 0) return false;
  if (!path.startsWith("/")) return false; // must be relative to this origin, never absolute
  if (path.startsWith("//")) return false; // protocol-relative -> different origin
  if (path.startsWith("/\\")) return false; // backslash-as-slash trick some browsers normalise to "//"
  if (path.includes("://")) return false; // embedded scheme
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(path)) return false; // control chars (incl. \t \n) used to smuggle a scheme past naive checks
  return true;
}

/**
 * Only ever returns a same-origin, relative app path - never an absolute
 * URL, protocol-relative URL, or another trip back into /auth/callback
 * itself (which would just re-enter this same decision loop). Falls back to
 * "/" for anything unsafe or missing.
 */
export function sanitizeInternalReturnPath(path: string | null | undefined): string {
  if (!path || !isSafeInternalPath(path)) return DEFAULT_SAFE_PATH;
  if (path === "/auth/callback" || path.startsWith("/auth/callback/") || path.startsWith("/auth/callback?") || path.startsWith("/auth/callback#")) {
    return DEFAULT_SAFE_PATH;
  }
  return path;
}
