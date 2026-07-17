import { normalizeRiderName } from "./tdf-data-utils.mjs";

/**
 * Deterministic alias generation for `public.uci_rider_aliases`, from a
 * canonical UCI rider's given/family names. Pure, no I/O. Alias upserts
 * are planned keyed on (rider_id, normalized_alias, alias_type) -- the
 * same tuple the DB's own unique index enforces -- so a re-run never
 * produces duplicate rows.
 *
 * `manual`/`race_organiser`/`former_name` alias types are never generated
 * here -- they're either created directly via
 * public.resolve_uci_rider_review_item() (an admin approving a race-entry
 * match) or would require a data source this module doesn't have.
 */

const dbNormalize = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// A generated alias whose normalized form is "too thin" to safely match
// against is rejected outright -- e.g. bare initials ("T P") or a single
// short token. This is a deliberate safety rule: an alias this short would
// match far too many unrelated riders during race-entry matching,
// defeating the purpose of an alias (a precise, high-confidence
// alternate name), not just being a low-quality one.
const MIN_ALIAS_SIGNAL_LENGTH = 4;

function isUnsafeBareInitials(normalizedAlias) {
  const words = normalizedAlias.split(" ").filter(Boolean);
  if (words.length === 0) return true;
  // Every word is a single letter (optionally with a trailing period,
  // already stripped by normalization) -- e.g. "t p" -- or the whole
  // alias, once whitespace is removed, is below the minimum signal
  // length (e.g. a single short token like "jo").
  const allSingleLetterWords = words.every((word) => word.length === 1);
  const collapsedLength = normalizedAlias.replace(/\s+/g, "").length;
  return allSingleLetterWords || collapsedLength < MIN_ALIAS_SIGNAL_LENGTH;
}

/**
 * Builds every deterministic alias candidate for one canonical rider.
 * Returns `{ aliasText, normalizedAlias, aliasType }[]`, already
 * de-duplicated by (normalizedAlias, aliasType) within this one rider's
 * own candidate set (a name whose surname-first and given-first forms
 * coincide, e.g. a mononym, should not produce two identical rows).
 * Every candidate whose normalizedAlias fails `isUnsafeBareInitials` is
 * rejected outright and never appears in the output, no matter which
 * generation rule produced it.
 */
export function generateRiderAliases({ givenName, familyName, canonicalDisplayName }) {
  const given = String(givenName ?? "").trim();
  const family = String(familyName ?? "").trim();
  const candidates = [];

  const pushCandidate = (aliasText, aliasType) => {
    const trimmed = String(aliasText ?? "").trim().replace(/\s+/g, " ");
    if (!trimmed) return;
    const normalizedAlias = dbNormalize(trimmed);
    if (isUnsafeBareInitials(normalizedAlias)) return;
    candidates.push({ aliasText: trimmed, normalizedAlias, aliasType });
  };

  if (canonicalDisplayName) pushCandidate(canonicalDisplayName, "uci_canonical");
  if (given && family) {
    pushCandidate(`${family} ${given}`, "surname_first");
    pushCandidate(`${given} ${family}`, "given_name_first");
  }
  if (canonicalDisplayName) {
    const accentless = normalizeRiderName(canonicalDisplayName)
      .split(" ")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
    pushCandidate(accentless, "accentless");
  }
  if (given && family) {
    // "T. Pogačar" style abbreviation -- a common race-organiser
    // shorthand. Still subject to the same bare-initials rejection above
    // (the family name portion supplies the required signal length).
    pushCandidate(`${given.charAt(0)}. ${family}`, "abbreviated");
  }

  // De-duplicate by (normalizedAlias, aliasType) -- e.g. a rider whose
  // given/family name order coincidentally produces the same string in
  // both surname_first and given_name_first (a single-word family name
  // with a single-word given name that's identical, or a mononym).
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.normalizedAlias}|${candidate.aliasType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Plans the alias upserts for one rider against its already-existing
 * alias rows (read from `uci_rider_aliases` for that `rider_id`). Every
 * generated candidate not already present (by normalized_alias +
 * alias_type) becomes an insert; everything else is left untouched
 * (aliases are never updated in place -- confidence/source on an
 * existing alias row is treated as sticky once created, since a manual
 * alias's higher confidence must never be silently downgraded by a
 * later deterministic-generation re-run).
 */
export function planRiderAliasSync({ riderId, givenName, familyName, canonicalDisplayName, source = "uci" }, existingAliases = []) {
  const generated = generateRiderAliases({ givenName, familyName, canonicalDisplayName });
  const existingKeys = new Set(existingAliases.map((alias) => `${alias.normalized_alias}|${alias.alias_type}`));

  const inserts = generated
    .filter((candidate) => !existingKeys.has(`${candidate.normalizedAlias}|${candidate.aliasType}`))
    .map((candidate) => ({
      rider_id: riderId,
      alias_text: candidate.aliasText,
      normalized_alias: candidate.normalizedAlias,
      alias_type: candidate.aliasType,
      source,
      confidence: "medium",
    }));

  return { inserts, generatedCount: generated.length, skippedExistingCount: generated.length - inserts.length };
}
