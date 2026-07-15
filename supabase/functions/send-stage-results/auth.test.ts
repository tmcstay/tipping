import assert from "node:assert/strict";
import test from "node:test";

import { constantTimeEqual, extractBearerToken, isAuthorizedSchedulerRequest } from "./auth.ts";

test("constantTimeEqual: matching strings are equal", () => {
  assert.equal(constantTimeEqual("super-secret", "super-secret"), true);
});

test("constantTimeEqual: differing strings are not equal", () => {
  assert.equal(constantTimeEqual("super-secret", "super-secreX"), false);
});

test("constantTimeEqual: differing lengths are not equal", () => {
  assert.equal(constantTimeEqual("short", "much-longer-secret"), false);
});

test("extractBearerToken: parses a standard Bearer header", () => {
  assert.equal(extractBearerToken("Bearer abc123"), "abc123");
});

test("extractBearerToken: returns null for missing/malformed header", () => {
  assert.equal(extractBearerToken(null), null);
  assert.equal(extractBearerToken("Basic abc123"), null);
  assert.equal(extractBearerToken(""), null);
});

test("isAuthorizedSchedulerRequest: correct bearer secret authorizes", () => {
  assert.equal(isAuthorizedSchedulerRequest("Bearer real-secret", "real-secret"), true);
});

test("isAuthorizedSchedulerRequest: internal authentication failure - wrong secret is rejected", () => {
  assert.equal(isAuthorizedSchedulerRequest("Bearer wrong-secret", "real-secret"), false);
});

test("isAuthorizedSchedulerRequest: internal authentication failure - missing header is rejected", () => {
  assert.equal(isAuthorizedSchedulerRequest(null, "real-secret"), false);
});

test("isAuthorizedSchedulerRequest: internal authentication failure - unconfigured secret never authorizes", () => {
  assert.equal(isAuthorizedSchedulerRequest("Bearer anything", null), false);
  assert.equal(isAuthorizedSchedulerRequest("Bearer anything", ""), false);
});

test("isAuthorizedSchedulerRequest: a normal user JWT is not a valid scheduler secret", () => {
  const fakeJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.signature";
  assert.equal(isAuthorizedSchedulerRequest(`Bearer ${fakeJwt}`, "real-secret"), false);
});
