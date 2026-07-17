import assert from "node:assert/strict";
import test from "node:test";

import { parseReviewArgs, runList, runResolve } from "./uci-rider-review.mjs";

const FAKE_SERVICE_KEY = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.sig`;

function withEnv(vars, fn) {
  const previous = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  Object.assign(process.env, vars);
  return fn().finally(() => {
    for (const key of Object.keys(vars)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

function fakeCreateClientFactory({ items = [], rpcResult = { status: "resolved" } } = {}) {
  const calls = { rpc: [] };
  const createClient = () => ({
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        then(resolve) { return resolve({ data: items, error: null }); },
      };
    },
    async rpc(name, params) {
      calls.rpc.push({ name, params });
      return { data: rpcResult, error: null };
    },
  });
  return { createClient, calls };
}

test("parseReviewArgs: defaults to listing pending items", () => {
  const options = parseReviewArgs([]);
  assert.equal(options.list, true);
  assert.equal(options.status, "pending");
});

test("parseReviewArgs: --resolve requires --resolve-status", () => {
  assert.throws(() => parseReviewArgs(["--resolve", "item-1"]), /--resolve-status/);
});

test("parseReviewArgs: --resolve + --resolve-status parses cleanly and disables --list", () => {
  const options = parseReviewArgs(["--resolve", "item-1", "--resolve-status", "matched"]);
  assert.equal(options.list, false);
  assert.equal(options.resolveId, "item-1");
  assert.equal(options.resolveStatus, "matched");
});

test("runList: reads uci_rider_review_queue via the service-role client", async () => {
  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_KEY }, async () => {
    const { createClient } = fakeCreateClientFactory({ items: [{ id: "1", status: "pending" }] });
    const options = parseReviewArgs([]);
    const items = await runList(options, { createClient });
    assert.equal(items.length, 1);
  });
});

test("runResolve: calls resolve_uci_rider_review_item with the expected params, including a null p_create_alias when not requested", async () => {
  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_KEY }, async () => {
    const { createClient, calls } = fakeCreateClientFactory();
    const options = parseReviewArgs(["--resolve", "item-1", "--resolve-status", "matched", "--note", "looks right"]);
    await runResolve(options, { createClient });
    assert.equal(calls.rpc.length, 1);
    assert.equal(calls.rpc[0].name, "resolve_uci_rider_review_item");
    assert.equal(calls.rpc[0].params.p_item_id, "item-1");
    assert.equal(calls.rpc[0].params.p_status, "matched");
    assert.equal(calls.rpc[0].params.p_note, "looks right");
    assert.equal(calls.rpc[0].params.p_create_alias, null);
  });
});

test("runResolve: builds p_create_alias when --create-alias/--alias-type/--alias-rider-id are supplied", async () => {
  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_KEY }, async () => {
    const { createClient, calls } = fakeCreateClientFactory();
    const options = parseReviewArgs([
      "--resolve", "item-1", "--resolve-status", "matched",
      "--create-alias", "J. Smith", "--alias-type", "manual", "--alias-rider-id", "rider-1",
    ]);
    await runResolve(options, { createClient });
    assert.deepEqual(calls.rpc[0].params.p_create_alias, { rider_id: "rider-1", alias_text: "J. Smith", alias_type: "manual" });
  });
});

test("buildServiceClient guard (via runList): refuses without SUPABASE_SERVICE_ROLE_KEY", async () => {
  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "" }, async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const options = parseReviewArgs([]);
    await assert.rejects(() => runList(options, {}), /SUPABASE_SERVICE_ROLE_KEY/);
  });
});
