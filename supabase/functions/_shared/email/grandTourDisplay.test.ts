import assert from "node:assert/strict";
import test from "node:test";

import { formatGrandTourName } from "./grandTourDisplay.ts";

test("Tour de France is displayed as 'Tour de France ’26' from the real production/local seed name", () => {
  assert.equal(formatGrandTourName({ name: "GrandTour France 2026", year: 2026 }), "Tour de France ’26");
});

test("never displays rejected variations", () => {
  const result = formatGrandTourName({ name: "GrandTour France 2026", year: 2026 });
  assert.notEqual(result, "France 2026");
  assert.notEqual(result, "Tour de France 2026");
  assert.notEqual(result, "France ’26");
  assert.notEqual(result, "TDF 2026");
});

test("Giro and Vuelta format with the abbreviated year", () => {
  assert.equal(formatGrandTourName({ name: "Giro d'Italia", year: 2026 }), "Giro d’Italia ’26");
  assert.equal(formatGrandTourName({ name: "Vuelta a España", year: 2026 }), "Vuelta a España ’26");
});

test("a missing/null source never throws", () => {
  assert.equal(formatGrandTourName(null), "Grand Tour");
  assert.equal(formatGrandTourName(undefined), "Grand Tour");
});
