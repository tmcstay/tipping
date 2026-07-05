import assert from "node:assert/strict";
import test from "node:test";

import { parseOfficialTourRidersHtml } from "./letour-official-riders.mjs";

test("fails closed when the official page is incomplete", () => {
  assert.throws(
    () => parseOfficialTourRidersHtml('<section class="competitors"></section>'),
    /competitors section|23 parsed teams/,
  );
});
