const assert = require("node:assert/strict");
const test = require("node:test");

const {
  formatRiderDisplayName,
  preferStageBibNumber
} = require("../../../dist/mobile-tests/formatters.js");

test("rider with a bib displays with the number", () => {
  assert.equal(formatRiderDisplayName("Rider Name", 12), "#12 Rider Name");
});

test("rider without a bib displays normally", () => {
  assert.equal(formatRiderDisplayName("Rider Name", null), "Rider Name");
  assert.equal(formatRiderDisplayName("Rider Name", undefined), "Rider Name");
});

test("stage-specific bib takes precedence over canonical rider bib", () => {
  assert.equal(preferStageBibNumber(34, 12), 34);
  assert.equal(formatRiderDisplayName("Rider Name", preferStageBibNumber(34, 12)), "#34 Rider Name");
  assert.equal(preferStageBibNumber(null, 12), 12);
});
