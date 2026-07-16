const assert = require("node:assert/strict");
const test = require("node:test");

const { formatGrandTourName } = require("../../../dist/mobile-tests/grandTourDisplay.js");

test("Tour de France is displayed as 'Tour de France ’26' from the real local seed name", () => {
  assert.equal(formatGrandTourName({ name: "GrandTour France 2026", year: 2026 }), "Tour de France ’26");
});

test("Tour de France is displayed the same way from a literal 'Tour de France 2026' name", () => {
  assert.equal(formatGrandTourName({ name: "Tour de France 2026", year: 2026 }), "Tour de France ’26");
});

test("never displays rejected variations", () => {
  const result = formatGrandTourName({ name: "GrandTour France 2026", year: 2026 });
  assert.notEqual(result, "France 2026");
  assert.notEqual(result, "Tour de France 2026");
  assert.notEqual(result, "France ’26");
  assert.notEqual(result, "TDF 2026");
});

test("Giro d'Italia formats with the abbreviated year", () => {
  assert.equal(formatGrandTourName({ name: "Giro d'Italia", year: 2026 }), "Giro d’Italia ’26");
});

test("Vuelta a España formats with the abbreviated year", () => {
  assert.equal(formatGrandTourName({ name: "Vuelta a España", year: 2026 }), "Vuelta a España ’26");
});

test("an unrecognised race name is title-preserved with its trailing year stripped and re-appended abbreviated", () => {
  assert.equal(formatGrandTourName({ name: "Some Other Race 2026", year: 2026 }), "Some Other Race ’26");
});

test("a missing year renders the official name alone, with no suffix", () => {
  assert.equal(formatGrandTourName({ name: "Tour de France 2026", year: null }), "Tour de France");
  assert.equal(formatGrandTourName({ name: "Tour de France 2026" }), "Tour de France");
});

test("a missing/null source never throws", () => {
  assert.equal(formatGrandTourName(null), "Grand Tour");
  assert.equal(formatGrandTourName(undefined), "Grand Tour");
  assert.equal(formatGrandTourName({}), "Grand Tour");
});

test("single-digit and two-digit years both abbreviate to a zero-padded two-digit suffix", () => {
  assert.equal(formatGrandTourName({ name: "Tour de France", year: 2005 }), "Tour de France ’05");
  assert.equal(formatGrandTourName({ name: "Tour de France", year: 2032 }), "Tour de France ’32");
});
