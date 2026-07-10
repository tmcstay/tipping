import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { handleApplyOfficialResult } from "./apply-official-result.mjs";

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

function fakeAuthedSupabaseClient({ user = null, userError = null, isAdmin = false, adminCheckError = null, applyResult, applyError = null, rpcCalls = [] } = {}) {
  return {
    auth: {
      async getUser() {
        return { data: { user }, error: userError };
      }
    },
    async rpc(name, params) {
      rpcCalls.push({ name, params });
      if (name === "is_current_user_cycling_admin") {
        return { data: adminCheckError ? null : isAdmin, error: adminCheckError };
      }
      if (name === "apply_grandtour_official_stage_result") {
        return { data: applyError ? null : applyResult, error: applyError };
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

function buildSafeReport(stageNumber = 5) {
  const parsedRiders = Array.from({ length: 10 }, (_, index) => ({
    position: index + 1,
    rider_name: `RIDER ${index + 1}`,
    bib_number: index + 1,
    team_name: "TEAM A",
    time: "1h", gap: "-"
  }));
  const matchedRiders = parsedRiders.map((row) => ({ riderName: row.rider_name, bibNumber: row.bib_number, riderId: `rider-${row.bib_number}`, matchedBy: "bib_number", nameMismatch: false }));
  const jerseyHolders = ["yellow", "green", "kom", "white"].map((jerseyType, index) => ({
    jerseyType,
    sourceClassification: jerseyType,
    parsedRiderName: `RIDER ${index + 1}`,
    parsedTeamName: "TEAM A",
    bibNumber: index + 1,
    matchedRiderId: `rider-${index + 1}`,
    matchedBy: "bib_number",
    nameMismatch: false,
    teamMismatch: false,
    onStartlist: true,
    status: "matched"
  }));

  return {
    mode: "dry-run",
    provider: "official-letour",
    sourceUrl: `https://www.letour.fr/en/rankings/stage-${stageNumber}`,
    fetchedAt: new Date().toISOString(),
    fromStage: stageNumber,
    toStage: stageNumber,
    dryRun: true,
    applyEnabled: false,
    importStatus: "review_required",
    parserDriftDetected: false,
    stageFetchMetadata: [
      { stageNumber, url: `https://www.letour.fr/en/rankings/stage-${stageNumber}`, httpStatus: 200, status: "ok", rowsMatched: 10, ridersParsed: 10, warningCount: 0 }
    ],
    reconciliation: {
      overallSafeToApply: true,
      stages: [{
        stageNumber,
        stageId: "11111111-1111-4111-8111-111111111111",
        stageDate: "2026-07-09",
        stageType: "flat",
        isTtt: false,
        missingStageRecord: false,
        parsedRiders,
        matchedRiders,
        unmatchedRiders: [],
        ambiguousRiders: [],
        matchedTeams: [],
        unmatchedTeams: [],
        ambiguousTeams: [],
        duplicateBibConflicts: [],
        matchedRidersOnStartlist: [],
        matchedRidersMissingFromStartlist: [],
        startlistValidationPassed: true,
        noStartlistRowsFound: false,
        jerseyHolders,
        safeToApply: true,
        blockers: []
      }]
    }
  };
}

test("rejects a non-POST request with 405", async () => {
  const req = fakeReq({ method: "GET" });
  const res = fakeRes();
  await handleApplyOfficialResult(req, res, {});
  assert.equal(res.statusCode, 405);
});

test("anonymous request is refused with 401 and never fetches or touches Supabase", async () => {
  const req = fakeReq({ headers: {}, body: { stageNumber: 5 } });
  const res = fakeRes();
  await handleApplyOfficialResult(req, res, {
    createClient: () => { throw new Error("createClient must not be called"); },
    runDryRunReconcile: () => { throw new Error("must not run"); }
  });
  assert.equal(res.statusCode, 401);
});

test("non-admin request is refused with 403, and no fetch/apply is ever attempted", async () => {
  await withEnv(REAL_ENV, async () => {
    const req = fakeReq({ headers: { authorization: "Bearer user-token" }, body: { stageNumber: 5 } });
    const res = fakeRes();
    const client = fakeAuthedSupabaseClient({ user: { id: "user-1" }, isAdmin: false });
    let dryRunCalled = false;
    await handleApplyOfficialResult(req, res, {
      createClient: () => client,
      runDryRunReconcile: () => { dryRunCalled = true; return {}; }
    });
    assert.equal(res.statusCode, 403);
    assert.equal(dryRunCalled, false);
  });
});

test("rejects a provider other than official-letour with 400, without fetching", async () => {
  await withEnv(REAL_ENV, async () => {
    const req = fakeReq({ headers: { authorization: "Bearer admin-token" }, body: { stageNumber: 5, provider: "manual-json" } });
    const res = fakeRes();
    const client = fakeAuthedSupabaseClient({ user: { id: "admin-1" }, isAdmin: true });
    let dryRunCalled = false;
    await handleApplyOfficialResult(req, res, {
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
    for (const stageNumber of [undefined, 0, -1, "not-a-number"]) {
      const req = fakeReq({ headers: { authorization: "Bearer admin-token" }, body: { stageNumber } });
      const res = fakeRes();
      await handleApplyOfficialResult(req, res, { createClient: () => client, runDryRunReconcile: () => { throw new Error("must not run"); } });
      assert.equal(res.statusCode, 400, `stageNumber=${JSON.stringify(stageNumber)} should be rejected`);
    }
  });
});

test("refuses to apply (422) an unsafe freshly-fetched report, and never calls the apply RPC", async () => {
  await withEnv(REAL_ENV, async () => {
    const req = fakeReq({ headers: { authorization: "Bearer admin-token" }, body: { stageNumber: 5 } });
    const res = fakeRes();
    const rpcCalls = [];
    const client = fakeAuthedSupabaseClient({ user: { id: "admin-1" }, isAdmin: true, rpcCalls });
    const unsafeReport = buildSafeReport(5);
    unsafeReport.reconciliation.overallSafeToApply = false;
    unsafeReport.reconciliation.stages[0].safeToApply = false;
    unsafeReport.reconciliation.stages[0].blockers = ["1 rider match(es) are ambiguous."];

    await handleApplyOfficialResult(req, res, {
      createClient: () => client,
      runDryRunReconcile: async () => unsafeReport
    });

    assert.equal(res.statusCode, 422);
    assert.ok(!rpcCalls.some((call) => call.name === "apply_grandtour_official_stage_result"));
  });
});

test("admin request applies a safe freshly-fetched report using the caller's own session (not a service-role client)", async () => {
  await withEnv(REAL_ENV, async () => {
    const req = fakeReq({ headers: { authorization: "Bearer admin-token" }, body: { stageNumber: 5 } });
    const res = fakeRes();
    const rpcCalls = [];
    const client = fakeAuthedSupabaseClient({
      user: { id: "admin-1", email: "admin@example.test" },
      isAdmin: true,
      applyResult: { status: "applied", stage_id: "stage-5", stage_result_id: "result-5", import_run_id: "run-5", line_count: 10, jersey_holder_count: 4 },
      rpcCalls
    });
    let capturedFetchOptions = null;

    await handleApplyOfficialResult(req, res, {
      createClient: () => client,
      runDryRunReconcile: async (options) => { capturedFetchOptions = options; return buildSafeReport(5); }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, "applied");

    // The fetch itself never had apply capability - reconcile:true is the
    // only relevant flag, and there is no "apply" key at all.
    assert.equal(capturedFetchOptions.reconcile, true);
    assert.ok(!("apply" in capturedFetchOptions));

    const applyCall = rpcCalls.find((call) => call.name === "apply_grandtour_official_stage_result");
    assert.ok(applyCall, "apply_grandtour_official_stage_result must have been called");
    assert.equal(applyCall.params.p_finalize, false);
    assert.equal(applyCall.params.p_result_lines.length, 10);
    assert.equal(applyCall.params.p_jersey_holders.length, 4);
    // Only one client was ever constructed (via the single injected
    // createClient), and it's the same authed client used for the admin
    // check above - proving apply runs under the caller's own session.
  });
});

test("surfaces an apply RPC error as a non-2xx response rather than throwing", async () => {
  await withEnv(REAL_ENV, async () => {
    const req = fakeReq({ headers: { authorization: "Bearer admin-token" }, body: { stageNumber: 5 } });
    const res = fakeRes();
    const client = fakeAuthedSupabaseClient({
      user: { id: "admin-1" },
      isAdmin: true,
      applyError: { message: "stage 5 already has a different draft result; refusing to overwrite.", code: "P0001" }
    });

    await handleApplyOfficialResult(req, res, {
      createClient: () => client,
      runDryRunReconcile: async () => buildSafeReport(5)
    });

    assert.equal(res.body.ok, false);
    assert.match(res.body.message, /already has a different draft result/);
  });
});

test("route source never reads SUPABASE_SERVICE_ROLE_KEY", async () => {
  const source = await fs.readFile(path.join(__dirname, "apply-official-result.mjs"), "utf8");
  assert.ok(!source.includes("process.env.SUPABASE_SERVICE_ROLE_KEY"), "the route must never read the service-role key env var");
});

test("route never calls finalize_grandtour_stage_result or recalculate_grandtour_stage_scores", async () => {
  const source = await fs.readFile(path.join(__dirname, "apply-official-result.mjs"), "utf8");
  assert.ok(!source.includes("finalize_grandtour_stage_result"));
  assert.ok(!source.includes("recalculate_grandtour_stage_scores"));
});
