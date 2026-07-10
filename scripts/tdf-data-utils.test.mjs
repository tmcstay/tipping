import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRiderName, normalizeTeamName, parseOptionalBibNumber } from "./tdf-data-utils.mjs";

test("parses an optional positive bib number", () => {
  assert.equal(parseOptionalBibNumber("12"), 12);
  assert.equal(parseOptionalBibNumber(""), null);
  assert.equal(parseOptionalBibNumber(null), null);
});

test("rejects invalid bib numbers before import", () => {
  assert.throws(() => parseOptionalBibNumber("-1"), /positive integer/i);
  assert.throws(() => parseOptionalBibNumber("1.5"), /positive integer/i);
});

test("normalizeTeamName equates official-letour's compact uppercase team names with canonical hyphen-spaced names", () => {
  const pairs = [
    ["LIDL-TREK", "Lidl - Trek"],
    ["GROUPAMA-FDJ UNITED", "Groupama - FDJ United"],
    ["BAHRAIN VICTORIOUS", "Bahrain - Victorious"],
    ["ALPECIN-PREMIER TECH", "Alpecin - Premier Tech"],
    ["CAJA RURAL-SEGUROS RGA", "Caja Rural - Seguros RGA"],
  ];

  for (const [officialLetourName, canonicalName] of pairs) {
    assert.equal(
      normalizeTeamName(officialLetourName),
      normalizeTeamName(canonicalName),
      `expected "${officialLetourName}" to normalize the same as "${canonicalName}"`,
    );
  }
});

test("normalizeTeamName folds punctuation/hyphens/pipes to whitespace, strips accents, and collapses spacing", () => {
  assert.equal(normalizeTeamName("Team Visma | Lease a Bike"), normalizeTeamName("Team Visma Lease a Bike"));
  assert.equal(normalizeTeamName("Red Bull - BORA - hansgrohe"), normalizeTeamName("red bull bora hansgrohe"));
  assert.equal(normalizeTeamName("Pinarello-Q36.5 Pro Cycling Team"), normalizeTeamName("PINARELLO Q36.5 PRO CYCLING TEAM"));
  assert.equal(normalizeTeamName("  Alpecin   -   Premier Tech  "), normalizeTeamName("Alpecin-Premier Tech"));
});

test("normalizeTeamName still distinguishes genuinely different team names", () => {
  assert.notEqual(normalizeTeamName("Lidl - Trek"), normalizeTeamName("Movistar Team"));
  assert.notEqual(normalizeTeamName("Alpecin - Premier Tech"), normalizeTeamName("Decathlon CMA CGM Team"));
});

test("normalizeRiderName is unaffected by the team-name punctuation change (hyphens in rider names are preserved as spacing only)", () => {
  assert.equal(normalizeRiderName("Jean-Pierre Dubois"), "jean-pierre dubois");
});
