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

/**
 * A stable string identifying "this specific callback attempt" - used by
 * AuthCallbackScreen to deduplicate exchange/setSession calls across
 * remounts (React Strict Mode's dev double-invoke, or a remount forced by
 * a Stack.Protected guard flipping while this screen is still active - see
 * its module doc comment). Two mounts that decide the exact same action
 * share one in-flight/completed attempt instead of each independently
 * calling Supabase, which would otherwise race a second attempt against an
 * already-consumed one-time-use code/token pair.
 */
export function getAuthCallbackFlowKey(action: AuthCallbackAction): string {
  switch (action.kind) {
    case "exchange_code":
      return `code:${action.code}`;
    case "set_session":
      return `tokens:${action.accessToken}:${action.refreshToken}`;
    case "show_error":
      return `error:${action.message}`;
    case "redirect_home":
      return "none";
  }
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
  if (isAuthCallbackPathname(path)) return DEFAULT_SAFE_PATH;
  return path;
}

/**
 * True for "/auth/callback" and any of its query/hash/sub-path variants.
 * Used both by `sanitizeInternalReturnPath` above (a stored/passed return
 * path must never point back into the callback route) and by
 * `ProtectedRoute` (the global "checking your session" loading gate must
 * never cover this route - it does its own independent session handling).
 */
export function isAuthCallbackPathname(pathname: string): boolean {
  return (
    pathname === "/auth/callback"
    || pathname.startsWith("/auth/callback/")
    || pathname.startsWith("/auth/callback?")
    || pathname.startsWith("/auth/callback#")
  );
}
