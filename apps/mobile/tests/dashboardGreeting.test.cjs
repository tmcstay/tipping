const assert = require("node:assert/strict");
const test = require("node:test");

const { resolveDashboardFirstName } = require("../../../dist/mobile-tests/dashboardGreeting.js");

test("uses first_name when present", () => {
  assert.equal(resolveDashboardFirstName("Tony", "Tony McStay"), "Tony");
});

test("falls back to the first token of display_name when first_name is missing", () => {
  assert.equal(resolveDashboardFirstName(null, "Tony McStay"), "Tony");
  assert.equal(resolveDashboardFirstName(undefined, "Tony McStay"), "Tony");
  assert.equal(resolveDashboardFirstName("", "Tony McStay"), "Tony");
});

test("falls back to a neutral greeting when neither is available", () => {
  assert.equal(resolveDashboardFirstName(null, null), "there");
  assert.equal(resolveDashboardFirstName(undefined, undefined), "there");
  assert.equal(resolveDashboardFirstName("  ", "  "), "there");
});
