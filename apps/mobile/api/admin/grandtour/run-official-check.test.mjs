import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { handleRunOfficialCheck } from "./run-official-check.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fakeReq({ method = "POST", headers = {}, body = {} } = {}) {
  return { method, headers, body };
}

function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; }
  };
  return res;
}

function fakeAuthedSupabaseClient({ user = null, userError = null, isAdmin = false, adminCheckError = null, rpcCalls = [] } = {}) {
  return {
    auth: {
      async getUser() {
        return { data: { user }, error: userError };
      }
    },
    async rpc(name) {
      rpcCalls.push(name);
      if (name === "is_current_user_cycling_admin") {
        return { data: adminCheckError ? null : isAdmin, error: adminCheckError };
      }
      throw new Error(`Unexpected rpc call: ${name}`);
    }
  };
}

const REAL_ENV = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: "anon-key" };

function withEnv(vars, fn) {
  const previous = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  Object.assign(process.env, vars);
  return Promise.resolve(fn()).finally(() => {
    for (const key of Object.keys(vars)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

test("rejects a non-POST request with 405", async () => {
  const req = fakeReq({ method: "GET" });
  const res = fakeRes();
  await handleRunOfficialCheck(req, res, {});
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.ok, false);
});

test("anonymous request (no Authorization header) is refused with 401 and never touches Supabase", async () => {
  const req = fakeReq({ headers: {}, body: { stageNumber: 5 } });
  const res = fakeRes();
  await handleRunOfficialCheck(req, res, {
    createClient: () => { throw new Error("createClient must not be called for an unauthenticated request"); }
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

test("an expired/invalid session token is refused with 401", async () => {
  await withEnv(REAL_ENV, async () => {
    const req = fakeReq({ headers: { authorization: "Bearer bad-token" }, body: { stageNumber: 5 } });
    const res = fakeRes();
    const client = fakeAuthedSupabaseClient({ user: null, userError: { message: "invalid token" } });
    await handleRunOfficialCheck(req, res, { createClient: () => client });
    assert.equal(res.statusCode, 401);
  });
});

test("non-admin request is refused with 403, and the dry-run/reconcile path is never invoked", async () => {
  await withEnv(REAL_ENV, async () => {
    const req = fakeReq({ headers: { authorization: "Bearer user-token" }, body: { stageNumber: 5 } });
    const res = fakeRes();
    const rpcCalls = [];
    const client = fakeAuthedSupabaseClient({ user: { id: "user-1" }, isAdmin: false, rpcCalls });
    let dryRunCalled = false;
    await handleRunOfficialCheck(req, res, {
      createClient: () => client,
      runDryRunReconcile: () => { dryRunCalled = true; return {}; }
    });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(rpcCalls, ["is_current_user_cycling_admin"]);
    assert.equal(dryRunCalled, false);
  });
});

test("admin request runs the dry-run/reconcile path and returns the report", async () => {
  await withEnv(REAL_ENV, async () => {
    const req = fakeReq({ headers: { authorization: "Bearer admin-token" }, body: { stageNumber: 5, grandTourName: "Tour de France", grandTourYear: 2026 } });
    const res = fakeRes();
    const client = fakeAuthedSupabaseClient({ user: { id: "admin-1" }, isAdmin: true });
    const fakeReport = { mode: "dry-run", fromStage: 5, toStage: 5, reconciliation: { overallSafeToApply: true, stages: [] } };
    let capturedOptions = null;
    await handleRunOfficialCheck(req, res, {
      createClient: () => client,
      runDryRunReconcile: async (options) => { capturedOptions = options; return fakeReport; }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.report, fakeReport);
    assert.equal(capturedOptions.provider, "official-letour");
    assert.equal(capturedOptions.fromStage, 5);
    assert.equal(capturedOptions.toStage, 5);
    assert.equal(capturedOptions.reconcile, true);
  });
});

test("the endpoint never passes an apply flag to runDryRunReconcile, for any request", async () => {
  await withEnv(REAL_ENV, async () => {
    const req = fakeReq({ headers: { authorization: "Bearer admin-token" }, body: { stageNumber: 5 } });
    const res = fakeRes();
    const client = fakeAuthedSupabaseClient({ user: { id: "admin-1" }, isAdmin: true });
    let capturedOptions = null;
    await handleRunOfficialCheck(req, res, {
      createClient: () => client,
      runDryRunReconcile: async (options) => { capturedOptions = options; return {}; }
    });

    assert.ok(!("apply" in capturedOptions), "options passed to runDryRunReconcile must never contain an apply key");
    assert.equal(capturedOptions.reconcile, true);
  });
});

test("rejects a provider other than official-letour with 400, without running the dry-run", async () => {
  await withEnv(REAL_ENV, async () => {
    const req = fakeReq({ headers: { authorization: "Bearer admin-token" }, body: { stageNumber: 5, provider: "manual-json" } });
    const res = fakeRes();
    const client = fakeAuthedSupabaseClient({ user: { id: "admin-1" }, isAdmin: true });
    let dryRunCalled = false;
    await handleRunOfficialCheck(req, res, {
      createClient: () => client,
      runDryRunReconcile: () => { dryRunCalled = true; return {}; }
    });
    assert.equal(res.statusCode, 400);
    assert.equal(dryRunCalled, false);
  });
});

test("rejects a missing/invalid stageNumber with 400", async () => {
  await withEnv(REAL_ENV, async () => {
    const client = fakeAuthedSupabaseClient({ user: { id: "admin-1" }, isAdmin: true });

    for (const stageNumber of [undefined, 0, -1, "not-a-number", 2.5]) {
      const req = fakeReq({ headers: { authorization: "Bearer admin-token" }, body: { stageNumber } });
      const res = fakeRes();
      await handleRunOfficialCheck(req, res, { createClient: () => client, runDryRunReconcile: () => { throw new Error("must not run"); } });
      assert.equal(res.statusCode, 400, `stageNumber=${JSON.stringify(stageNumber)} should be rejected`);
    }
  });
});

test("returns 502 (not a 500 crash) when the dry-run/reconcile itself throws", async () => {
  await withEnv(REAL_ENV, async () => {
    const req = fakeReq({ headers: { authorization: "Bearer admin-token" }, body: { stageNumber: 5 } });
    const res = fakeRes();
    const client = fakeAuthedSupabaseClient({ user: { id: "admin-1" }, isAdmin: true });
    await handleRunOfficialCheck(req, res, {
      createClient: () => client,
      runDryRunReconcile: async () => { throw new Error("letour.fr fetch failed"); }
    });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.ok, false);
  });
});

test("route source never reads SUPABASE_SERVICE_ROLE_KEY", async () => {
  const source = await fs.readFile(path.join(__dirname, "run-official-check.mjs"), "utf8");
  // The doc comment mentions the env var name in prose (explaining that
  // it's never used) - that's expected and fine. What must never appear is
  // an actual read of it. (Whether an apply flag is ever passed to
  // runDryRunReconcile is proven behaviourally above, not by source-text
  // scanning - this route calls a function directly, it doesn't build a
  // CLI argv, so there is no "--apply" string to look for either way.)
  assert.ok(!source.includes("process.env.SUPABASE_SERVICE_ROLE_KEY"), "the route must never read the service-role key env var");
});
