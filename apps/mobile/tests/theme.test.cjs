const assert = require("node:assert/strict");
const test = require("node:test");

const { getRaceHeadingAccent } = require("../../../dist/mobile-tests/raceAccent.js");

test("Tour de France gets the real maillot jaune yellow (used for the underline bar only, never heading text)", () => {
  const color = getRaceHeadingAccent("Tour de France 2026");
  assert.equal(color, "#F4C430");
});

test("Giro d'Italia gets a pink accent", () => {
  assert.equal(getRaceHeadingAccent("Giro d'Italia"), "#D6336C");
});

test("Vuelta a España gets a red accent", () => {
  assert.equal(getRaceHeadingAccent("Vuelta a España"), "#C1121F");
});

test("an unknown or missing race name falls back to the default GWFC Blue primary", () => {
  assert.equal(getRaceHeadingAccent("Some Other Race"), "#425197");
  assert.equal(getRaceHeadingAccent(null), "#425197");
  assert.equal(getRaceHeadingAccent(undefined), "#425197");
});
