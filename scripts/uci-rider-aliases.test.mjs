import assert from "node:assert/strict";
import test from "node:test";

import { generateRiderAliases, planRiderAliasSync } from "./uci-rider-aliases.mjs";

test("generateRiderAliases: produces uci_canonical, surname_first, given_name_first, accentless, and abbreviated forms", () => {
  const aliases = generateRiderAliases({ givenName: "Tadej", familyName: "Pogačar", canonicalDisplayName: "Tadej Pogačar" });
  const byType = Object.fromEntries(aliases.map((alias) => [alias.aliasType, alias.aliasText]));
  assert.equal(byType.uci_canonical, "Tadej Pogačar");
  assert.equal(byType.surname_first, "Pogačar Tadej");
  assert.equal(byType.given_name_first, "Tadej Pogačar");
  assert.equal(byType.accentless, "Tadej Pogacar");
  assert.equal(byType.abbreviated, "T. Pogačar");
});

test("generateRiderAliases: accentless form strips diacritics via the existing normalizeRiderName accent-fold, then title-cases", () => {
  const aliases = generateRiderAliases({ givenName: "Wout", familyName: "van Aert", canonicalDisplayName: "Wout van Aert" });
  const accentless = aliases.find((alias) => alias.aliasType === "accentless");
  assert.equal(accentless.normalizedAlias, "wout van aert");
});

test("generateRiderAliases: rejects unsafe bare-initials aliases (every word a single letter)", () => {
  const aliases = generateRiderAliases({ givenName: "A", familyName: "B", canonicalDisplayName: "A B" });
  assert.equal(aliases.length, 0, "a name that collapses to bare initials in every generation rule must produce zero aliases");
});

test("generateRiderAliases: rejects a candidate below the minimum signal length even if not literally single letters", () => {
  const aliases = generateRiderAliases({ givenName: "Jo", familyName: "Yu", canonicalDisplayName: "Jo Yu" });
  for (const alias of aliases) {
    assert.ok(alias.normalizedAlias.replace(/\s+/g, "").length >= 4, `alias "${alias.aliasText}" is below the minimum signal length and should have been rejected`);
  }
});

test("generateRiderAliases: de-duplicates candidates that coincide across generation rules", () => {
  const aliases = generateRiderAliases({ givenName: "Cavendish", familyName: "Cavendish", canonicalDisplayName: "Cavendish Cavendish" });
  const seen = new Set();
  for (const alias of aliases) {
    const key = `${alias.normalizedAlias}|${alias.aliasType}`;
    assert.equal(seen.has(key), false, "duplicate (normalizedAlias, aliasType) pair found");
    seen.add(key);
  }
});

test("generateRiderAliases: missing given/family name still yields at least the canonical + accentless forms", () => {
  const aliases = generateRiderAliases({ givenName: null, familyName: null, canonicalDisplayName: "Remco Evenepoel" });
  const types = aliases.map((alias) => alias.aliasType);
  assert.ok(types.includes("uci_canonical"));
  assert.ok(types.includes("accentless"));
  assert.ok(!types.includes("surname_first"), "surname_first requires both given and family name");
});

test("planRiderAliasSync: every generated alias becomes an insert when no existing aliases exist", () => {
  const plan = planRiderAliasSync({ riderId: "r1", givenName: "Tadej", familyName: "Pogačar", canonicalDisplayName: "Tadej Pogačar" }, []);
  assert.ok(plan.inserts.length > 0);
  assert.ok(plan.inserts.every((row) => row.rider_id === "r1"));
  assert.equal(plan.skippedExistingCount, 0);
});

test("planRiderAliasSync: an alias already present (by normalized_alias + alias_type) is skipped, not re-inserted", () => {
  // uci_canonical's normalized form is a plain lowercase (no accent-fold —
  // see generateRiderAliases' pushCandidate), so the existing fixture row
  // must match that exact accented normalization to be recognised as
  // already present.
  const existing = [{ normalized_alias: "tadej pogačar", alias_type: "uci_canonical" }];
  const plan = planRiderAliasSync({ riderId: "r1", givenName: "Tadej", familyName: "Pogačar", canonicalDisplayName: "Tadej Pogačar" }, existing);
  assert.ok(!plan.inserts.some((row) => row.normalized_alias === "tadej pogačar" && row.alias_type === "uci_canonical"));
  assert.equal(plan.skippedExistingCount, 1);
});

test("planRiderAliasSync: re-running with a fully-existing alias set produces zero inserts (idempotent)", () => {
  const first = planRiderAliasSync({ riderId: "r1", givenName: "Tadej", familyName: "Pogačar", canonicalDisplayName: "Tadej Pogačar" }, []);
  const existingAfterFirstApply = first.inserts.map((row) => ({ normalized_alias: row.normalized_alias, alias_type: row.alias_type }));
  const second = planRiderAliasSync({ riderId: "r1", givenName: "Tadej", familyName: "Pogačar", canonicalDisplayName: "Tadej Pogačar" }, existingAfterFirstApply);
  assert.equal(second.inserts.length, 0);
});
