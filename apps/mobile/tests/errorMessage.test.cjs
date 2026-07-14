const assert = require("node:assert/strict");
const test = require("node:test");

const { toSafeErrorMessage } = require("../../../dist/mobile-tests/errorMessage.js");

test("an Error instance renders its own message", () => {
  assert.equal(toSafeErrorMessage(new Error("boom")), "boom");
});

test("a plain string passes through unchanged", () => {
  assert.equal(toSafeErrorMessage("already broken"), "already broken");
});

test("a PostgrestError-shaped plain object (has .message, not an Error instance) renders its message, never '[object Object]'", () => {
  const fakePostgrestError = { message: "permission denied for table profiles", code: "42501", details: null, hint: null };
  const result = toSafeErrorMessage(fakePostgrestError);
  assert.equal(result, "permission denied for table profiles");
  assert.notEqual(result, "[object Object]");
});

test("an object with no usable .message falls back to the generic message, never '[object Object]'", () => {
  const result = toSafeErrorMessage({ code: "unknown" });
  assert.notEqual(result, "[object Object]");
  assert.equal(result, "Something went wrong. Please try again.");
});

test("a custom fallback is used when provided", () => {
  assert.equal(toSafeErrorMessage({}, "Unable to save your profile."), "Unable to save your profile.");
});

test("null/undefined never render as '[object Object]'", () => {
  assert.notEqual(toSafeErrorMessage(null), "[object Object]");
  assert.notEqual(toSafeErrorMessage(undefined), "[object Object]");
});
