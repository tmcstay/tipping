import assert from "node:assert/strict";
import test from "node:test";

import { parseOfficialTourRidersHtml } from "./tdf-2026-rider-parsers.mjs";

test("re-exports parseOfficialTourRidersHtml from scripts/letour-official-riders.mjs (fails closed on an incomplete page, matching that module's own test)", () => {
  assert.throws(
    () => parseOfficialTourRidersHtml('<section class="competitors"></section>'),
    /competitors section|23 parsed teams/,
  );
});
