import assert from "node:assert/strict";
import test from "node:test";

import { parseOptionalBibNumber } from "./tdf-data-utils.mjs";

test("parses an optional positive bib number", () => {
  assert.equal(parseOptionalBibNumber("12"), 12);
  assert.equal(parseOptionalBibNumber(""), null);
  assert.equal(parseOptionalBibNumber(null), null);
});

test("rejects invalid bib numbers before import", () => {
  assert.throws(() => parseOptionalBibNumber("-1"), /positive integer/i);
  assert.throws(() => parseOptionalBibNumber("1.5"), /positive integer/i);
});
