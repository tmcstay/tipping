const assert = require("node:assert/strict");
const test = require("node:test");

const {
  decideAuthCallbackAction,
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
