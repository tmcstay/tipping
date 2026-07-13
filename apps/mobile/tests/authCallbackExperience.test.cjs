const assert = require("node:assert/strict");
const test = require("node:test");

const {
  decideAuthCallbackAction,
  getAuthCallbackFlowKey,
  isAuthCallbackPathname,
  parseHashParams,
  sanitizeInternalReturnPath
} = require("../../../dist/mobile-tests/authCallbackExperience.js");

test("decideAuthCallbackAction: a PKCE code triggers exchange_code", () => {
  const action = decideAuthCallbackAction({ code: "abc123" });
  assert.deepEqual(action, { kind: "exchange_code", code: "abc123" });
});

test("decideAuthCallbackAction: an implicit-flow token pair triggers set_session", () => {
  const action = decideAuthCallbackAction({
    access_token: "at-1",
    refresh_token: "rt-1"
  });
  assert.deepEqual(action, { kind: "set_session", accessToken: "at-1", refreshToken: "rt-1" });
});

test("decideAuthCallbackAction: an access_token with no refresh_token is not enough - redirects home", () => {
  const action = decideAuthCallbackAction({ access_token: "at-1" });
  assert.deepEqual(action, { kind: "redirect_home" });
});

test("decideAuthCallbackAction: a Supabase error param shows the error, even if a code is also present", () => {
  const action = decideAuthCallbackAction({
    code: "abc123",
    error: "access_denied",
    error_description: "Email link is invalid or has expired"
  });
  assert.deepEqual(action, { kind: "show_error", message: "Email link is invalid or has expired" });
});

test("decideAuthCallbackAction: error alone (no error_description) still shows an error", () => {
  const action = decideAuthCallbackAction({ error: "access_denied" });
  assert.deepEqual(action, { kind: "show_error", message: "access_denied" });
});

test("decideAuthCallbackAction: no params at all redirects home instead of spinning", () => {
  const action = decideAuthCallbackAction({});
  assert.deepEqual(action, { kind: "redirect_home" });
});

test("decideAuthCallbackAction: blank/whitespace-only params are treated as absent", () => {
  const action = decideAuthCallbackAction({ code: "   ", error: "", error_description: undefined });
  assert.deepEqual(action, { kind: "redirect_home" });
});

test("parseHashParams: parses a leading-# hash fragment into a plain object", () => {
  assert.deepEqual(
    parseHashParams("#access_token=at-1&refresh_token=rt-1&type=recovery"),
    { access_token: "at-1", refresh_token: "rt-1", type: "recovery" }
  );
});

test("parseHashParams: works without a leading #", () => {
  assert.deepEqual(parseHashParams("access_token=at-1"), { access_token: "at-1" });
});

test("parseHashParams: an empty hash returns an empty object", () => {
  assert.deepEqual(parseHashParams(""), {});
  assert.deepEqual(parseHashParams("#"), {});
});

test("sanitizeInternalReturnPath: keeps a plain internal path", () => {
  assert.equal(sanitizeInternalReturnPath("/my-tips"), "/my-tips");
});

test("sanitizeInternalReturnPath: falls back to / when missing", () => {
  assert.equal(sanitizeInternalReturnPath(null), "/");
  assert.equal(sanitizeInternalReturnPath(undefined), "/");
  assert.equal(sanitizeInternalReturnPath(""), "/");
});

test("sanitizeInternalReturnPath: rejects an absolute external URL", () => {
  assert.equal(sanitizeInternalReturnPath("https://evil.example/phish"), "/");
});

test("sanitizeInternalReturnPath: rejects a protocol-relative URL", () => {
  assert.equal(sanitizeInternalReturnPath("//evil.example/phish"), "/");
});

test("sanitizeInternalReturnPath: rejects a backslash-slash trick", () => {
  assert.equal(sanitizeInternalReturnPath("/\\evil.example"), "/");
});

test("sanitizeInternalReturnPath: rejects an embedded scheme", () => {
  assert.equal(sanitizeInternalReturnPath("/redirect?to=javascript://alert(1)"), "/");
});

test("sanitizeInternalReturnPath: never sends the user back into /auth/callback (loop prevention)", () => {
  assert.equal(sanitizeInternalReturnPath("/auth/callback"), "/");
  assert.equal(sanitizeInternalReturnPath("/auth/callback?code=abc"), "/");
});

// ---------------------------------------------------------------------------
// isAuthCallbackPathname - used by ProtectedRoute to exclude /auth/callback
// from the global "checking your session" loading gate.
// ---------------------------------------------------------------------------

test("isAuthCallbackPathname: matches the bare route and its query/hash/sub-path variants", () => {
  assert.equal(isAuthCallbackPathname("/auth/callback"), true);
  assert.equal(isAuthCallbackPathname("/auth/callback?code=abc"), true);
  assert.equal(isAuthCallbackPathname("/auth/callback#access_token=x"), true);
  assert.equal(isAuthCallbackPathname("/auth/callback/"), true);
});

test("isAuthCallbackPathname: does not match unrelated routes, including near-miss prefixes", () => {
  assert.equal(isAuthCallbackPathname("/"), false);
  assert.equal(isAuthCallbackPathname("/login"), false);
  assert.equal(isAuthCallbackPathname("/auth/callback-extra"), false);
  assert.equal(isAuthCallbackPathname("/auth/callbacks"), false);
});

// ---------------------------------------------------------------------------
// getAuthCallbackFlowKey - deduplicates exchange/setSession calls across
// remounts (React Strict Mode's dev double-invoke, or a remount forced by
// a Stack.Protected guard flip while the callback screen is still active).
// ---------------------------------------------------------------------------

test("getAuthCallbackFlowKey: the same exchange_code action always produces the same key (dedup across remounts)", () => {
  const action = { kind: "exchange_code", code: "abc123" };
  assert.equal(getAuthCallbackFlowKey(action), getAuthCallbackFlowKey({ ...action }));
});

test("getAuthCallbackFlowKey: a repeated effect invocation for the identical code never produces a fresh/different key", () => {
  // Simulates React Strict Mode (or a guard-flip-forced remount) running
  // the same effect twice for the exact same URL - the second mount must
  // resolve to the same registry key as the first, so it reuses the
  // in-flight/completed attempt instead of calling Supabase again.
  const keys = new Set();
  for (let i = 0; i < 2; i += 1) {
    const action = decideAuthCallbackAction({ code: "abc123" });
    keys.add(getAuthCallbackFlowKey(action));
  }
  assert.equal(keys.size, 1);
});

test("getAuthCallbackFlowKey: different codes produce different keys", () => {
  assert.notEqual(
    getAuthCallbackFlowKey({ kind: "exchange_code", code: "abc123" }),
    getAuthCallbackFlowKey({ kind: "exchange_code", code: "xyz789" })
  );
});

test("getAuthCallbackFlowKey: set_session is keyed on both tokens", () => {
  const key1 = getAuthCallbackFlowKey({ kind: "set_session", accessToken: "at-1", refreshToken: "rt-1" });
  const key2 = getAuthCallbackFlowKey({ kind: "set_session", accessToken: "at-1", refreshToken: "rt-2" });
  assert.notEqual(key1, key2);
});

test("getAuthCallbackFlowKey: show_error and redirect_home each produce a distinct, stable key", () => {
  assert.equal(
    getAuthCallbackFlowKey({ kind: "show_error", message: "expired" }),
    getAuthCallbackFlowKey({ kind: "show_error", message: "expired" })
  );
  assert.equal(getAuthCallbackFlowKey({ kind: "redirect_home" }), "none");
});
