import assert from "node:assert/strict";
import test from "node:test";

import { canSubmitTip, isMarketLocked } from "../dist/locking.js";

const event = {
  lockAt: "2026-03-08T03:50:00.000Z"
};

const openMarket = {
  lockAt: null,
  status: "open"
};

test("can tip before lock time", () => {
  assert.equal(
    canSubmitTip({
      event,
      market: openMarket,
      now: "2026-03-08T03:49:59.000Z"
    }),
    true
  );
});

test("cannot tip after lock time", () => {
  assert.equal(
    canSubmitTip({
      event,
      market: openMarket,
      now: "2026-03-08T03:50:00.000Z"
    }),
    false
  );
});

test("can update before lock time", () => {
  assert.equal(
    isMarketLocked({
      event,
      market: {
        lockAt: "2026-03-08T03:55:00.000Z",
        status: "open"
      },
      now: "2026-03-08T03:54:59.000Z"
    }),
    false
  );
});

test("cannot update after lock time", () => {
  assert.equal(
    isMarketLocked({
      event,
      market: {
        lockAt: "2026-03-08T03:55:00.000Z",
        status: "open"
      },
      now: "2026-03-08T03:55:00.000Z"
    }),
    true
  );
});
