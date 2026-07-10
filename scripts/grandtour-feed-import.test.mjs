import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { runApply, runDryRunReconcile } from "./grandtour-feed-import.mjs";

const STAGE_ID = "11111111-1111-4111-8111-111111111111";
const REAL_SERVICE_ROLE_JWT = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
const ANON_JWT = `header.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`;

function riderRow(position, { name, bib }) {
  return { position, rider_name: name, bib_number: bib, team_name: "TEAM A", time: "03h 40' 00\"", gap: "-" };
}

function jerseyHolder(jerseyType, { riderId, bib, name }) {
  return {
    jerseyType,
    sourceClassification: { yellow: "individual", green: "points", kom: "climber", white: "youth" }[jerseyType],
    parsedRiderName: name,
    parsedTeamName: "TEAM A",
    bibNumber: bib,
    matchedRiderId: riderId,
    matchedBy: "bib_number",
    nameMismatch: false,
    teamMismatch: false,
    onStartlist: true,
    status: "matched"
  };
}

function buildFourMatchedJerseyHolders() {
  return [
    jerseyHolder("yellow", { riderId: "jersey-rider-yellow", bib: 101, name: "YELLOW RIDER" }),
    jerseyHolder("green", { riderId: "jersey-rider-green", bib: 102, name: "GREEN RIDER" }),
    jerseyHolder("kom", { riderId: "jersey-rider-kom", bib: 103, name: "KOM RIDER" }),
    jerseyHolder("white", { riderId: "jersey-rider-white", bib: 104, name: "WHITE RIDER" })
  ];
}

function buildValidReport() {
  const parsedRiders = Array.from({ length: 10 }, (_, index) => riderRow(index + 1, { name: `RIDER ${index + 1}`, bib: index + 1 }));
  const matchedRiders = parsedRiders.map((row) => ({ riderName: row.rider_name, bibNumber: row.bib_number, riderId: `rider-${row.bib_number}`, matchedBy: "bib_number", nameMismatch: false }));

  return {
    mode: "dry-run",
    provider: "official-letour",
    sourceUrl: "https://www.letour.fr/en/rankings/stage-2",
    fetchedAt: new Date().toISOString(),
    fromStage: 2,
    toStage: 2,
    dryRun: true,
    applyEnabled: false,
    importStatus: "review_required",
    parserDriftDetected: false,
    stageFetchMetadata: [
      { stageNumber: 2, url: "https://www.letour.fr/en/rankings/stage-2", httpStatus: 200, status: "ok", rowsMatched: 10, ridersParsed: 10, warningCount: 0 }
    ],
    reconciliation: {
      overallSafeToApply: true,
      stages: [{
        stageNumber: 2,
        stageId: STAGE_ID,
        stageDate: "2026-07-05",
        stageType: "hilly",
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
        jerseyHolders: buildFourMatchedJerseyHolders(),
        safeToApply: true,
        blockers: []
      }]
    }
  };
}

async function withTempReportFile(report, fn) {
  const filePath = path.resolve("tmp", `apply-test-report-${Math.random().toString(36).slice(2)}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(report), "utf8");
  try {
    return await fn(filePath);
  } finally {
    await fs.rm(filePath, { force: true });
  }
}

function baseOptions(overrides = {}) {
  return {
    confirmProvider: "official-letour",
    confirmStage: 2,
    confirmProduction: false,
    reason: null,
    requestId: null,
    reportPath: path.resolve("tmp", `apply-test-outcome-${Math.random().toString(36).slice(2)}.json`),
    ...overrides
  };
}

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

test("runApply refuses when SUPABASE_SERVICE_ROLE_KEY is missing (only anon-shaped credentials present)", async () => {
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: ANON_JWT }, async () => {
      await withTempReportFile(buildValidReport(), async (fromReportPath) => {
        await assert.rejects(
          () => runApply(baseOptions({ fromReportPath })),
          /SUPABASE_SERVICE_ROLE_KEY/
        );
      });
    });
  } finally {
    if (previousServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("runApply refuses when SUPABASE_SERVICE_ROLE_KEY decodes to a non-service_role JWT", async () => {
  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: ANON_JWT }, async () => {
    await withTempReportFile(buildValidReport(), async (fromReportPath) => {
      await assert.rejects(
        () => runApply(baseOptions({ fromReportPath })),
        /not "service_role"/
      );
    });
  });
});

test("runApply refuses a production Supabase URL without --confirm-production", async () => {
  await withEnv({ SUPABASE_URL: "https://nsdpilmmrfobiapbwona.supabase.co", SUPABASE_SERVICE_ROLE_KEY: REAL_SERVICE_ROLE_JWT }, async () => {
    await withTempReportFile(buildValidReport(), async (fromReportPath) => {
      await assert.rejects(
        () => runApply(baseOptions({ fromReportPath, confirmProduction: false })),
        /production project/
      );
    });
  });
});

test("runApply calls the RPC exactly once with p_finalize=false for a valid report, and writes an outcome report", async () => {
  const calls = [];
  const fakeClient = {
    async rpc(functionName, params) {
      calls.push({ functionName, params });
      return { data: { status: "applied", stage_id: STAGE_ID, stage_result_id: "result-1", import_run_id: "run-1", line_count: 10 }, error: null };
    }
  };
  let createClientCallCount = 0;
  const createClient = () => {
    createClientCallCount += 1;
    return fakeClient;
  };

  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: REAL_SERVICE_ROLE_JWT }, async () => {
    await withTempReportFile(buildValidReport(), async (fromReportPath) => {
      const options = baseOptions({ fromReportPath });
      await runApply(options, { createClient });

      assert.equal(createClientCallCount, 1);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].functionName, "apply_grandtour_official_stage_result");
      assert.equal(calls[0].params.p_finalize, false);
      assert.equal(calls[0].params.p_stage_id, STAGE_ID);
      assert.equal(calls[0].params.p_result_lines.length, 10);

      const written = JSON.parse(await fs.readFile(options.reportPath, "utf8"));
      assert.equal(written.outcome.status, "applied");
      await fs.rm(options.reportPath, { force: true });
    });
  });
});

test("runApply treats an RPC no_change response as success (does not throw)", async () => {
  const fakeClient = {
    async rpc() {
      return { data: { status: "no_change", stage_id: STAGE_ID, stage_result_id: "result-1", line_count: 10 }, error: null };
    }
  };

  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: REAL_SERVICE_ROLE_JWT }, async () => {
    await withTempReportFile(buildValidReport(), async (fromReportPath) => {
      const options = baseOptions({ fromReportPath });
      await runApply(options, { createClient: () => fakeClient });

      const written = JSON.parse(await fs.readFile(options.reportPath, "utf8"));
      assert.equal(written.outcome.status, "no_change");
      assert.equal(written.outcome.exitCode, 0);
      await fs.rm(options.reportPath, { force: true });
    });
  });
});

test("runApply surfaces an RPC error as a thrown failure, calling the RPC exactly once with no retry", async () => {
  let rpcCallCount = 0;
  const fakeClient = {
    async rpc() {
      rpcCallCount += 1;
      return { data: null, error: { message: "apply_grandtour_official_stage_result: stage 2 already has a different draft result; refusing to overwrite." } };
    }
  };

  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: REAL_SERVICE_ROLE_JWT }, async () => {
    await withTempReportFile(buildValidReport(), async (fromReportPath) => {
      const options = baseOptions({ fromReportPath });
      await assert.rejects(
        () => runApply(options, { createClient: () => fakeClient }),
        /already has a different draft result/
      );
      assert.equal(rpcCallCount, 1);

      const written = JSON.parse(await fs.readFile(options.reportPath, "utf8"));
      assert.equal(written.outcome.status, "error");
      await fs.rm(options.reportPath, { force: true });
    });
  });
});

test("runApply refuses before ever constructing a Supabase client when the report fails validation", async () => {
  let createClientCallCount = 0;
  const createClient = () => {
    createClientCallCount += 1;
    return { async rpc() { throw new Error("should never be called"); } };
  };

  const invalidReport = buildValidReport();
  invalidReport.reconciliation.stages[0].safeToApply = false;

  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: REAL_SERVICE_ROLE_JWT }, async () => {
    await withTempReportFile(invalidReport, async (fromReportPath) => {
      await assert.rejects(
        () => runApply(baseOptions({ fromReportPath }), { createClient }),
        /safeToApply must be true/
      );
      assert.equal(createClientCallCount, 0, "must not connect to Supabase for a report that fails local validation");
    });
  });
});

test("runApply refuses a TTT report before calling the RPC", async () => {
  let rpcCallCount = 0;
  const fakeClient = { async rpc() { rpcCallCount += 1; return { data: null, error: null }; } };

  const tttReport = buildValidReport();
  tttReport.reconciliation.stages[0].isTtt = true;
  tttReport.reconciliation.stages[0].stageType = "team_time_trial";
  tttReport.reconciliation.stages[0].safeToApply = false;
  tttReport.reconciliation.stages[0].blockers = ["Stage is a TTT"];

  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: REAL_SERVICE_ROLE_JWT }, async () => {
    await withTempReportFile(tttReport, async (fromReportPath) => {
      await assert.rejects(() => runApply(baseOptions({ fromReportPath }), { createClient: () => fakeClient }));
      assert.equal(rpcCallCount, 0);
    });
  });
});

test("runApply refuses a report with 7 result rows (6-9 is never valid) before calling the RPC", async () => {
  let rpcCallCount = 0;
  const fakeClient = { async rpc() { rpcCallCount += 1; return { data: null, error: null }; } };

  const sevenRowReport = buildValidReport();
  const stage = sevenRowReport.reconciliation.stages[0];
  stage.parsedRiders = stage.parsedRiders.slice(0, 7);
  stage.matchedRiders = stage.matchedRiders.slice(0, 7);

  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: REAL_SERVICE_ROLE_JWT }, async () => {
    await withTempReportFile(sevenRowReport, async (fromReportPath) => {
      await assert.rejects(
        () => runApply(baseOptions({ fromReportPath }), { createClient: () => fakeClient }),
        /requires exactly 10/
      );
      assert.equal(rpcCallCount, 0);
    });
  });
});

test("runApply refuses exactly 5 result rows — v1 policy is top-10-only, before calling the RPC", async () => {
  let rpcCallCount = 0;
  const fakeClient = { async rpc() { rpcCallCount += 1; return { data: null, error: null }; } };

  const fiveRowReport = buildValidReport();
  const stage = fiveRowReport.reconciliation.stages[0];
  stage.parsedRiders = stage.parsedRiders.slice(0, 5);
  stage.matchedRiders = stage.matchedRiders.slice(0, 5);

  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: REAL_SERVICE_ROLE_JWT }, async () => {
    await withTempReportFile(fiveRowReport, async (fromReportPath) => {
      await assert.rejects(
        () => runApply(baseOptions({ fromReportPath }), { createClient: () => fakeClient }),
        /requires exactly 10/
      );
      assert.equal(rpcCallCount, 0);
    });
  });
});

test("runApply: a stage mismatch cannot be bypassed by editing only one of the redundant report fields", async () => {
  let rpcCallCount = 0;
  const fakeClient = { async rpc() { rpcCallCount += 1; return { data: null, error: null }; } };

  // Edit only report.fromStage/toStage to "agree" with --confirm-stage=3, while
  // reconciliation.stages[0].stageNumber (and its real stageId) still say stage 2.
  // If only one field were checked, this could slip through as stage 3.
  const partiallyEditedReport = buildValidReport();
  partiallyEditedReport.fromStage = 3;
  partiallyEditedReport.toStage = 3;

  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: REAL_SERVICE_ROLE_JWT }, async () => {
    await withTempReportFile(partiallyEditedReport, async (fromReportPath) => {
      await assert.rejects(
        () => runApply(baseOptions({ fromReportPath, confirmStage: 3 }), { createClient: () => fakeClient }),
        /stageNumber.*does not match/s
      );
      assert.equal(rpcCallCount, 0);
    });
  });
});

test("runApply: a stage mismatch cannot be bypassed by editing only reconciliation.stages[0].stageNumber", async () => {
  let rpcCallCount = 0;
  const fakeClient = { async rpc() { rpcCallCount += 1; return { data: null, error: null }; } };

  // Inverse of the above: only the per-stage stageNumber is edited to "agree"
  // with --confirm-stage=3; report.fromStage/toStage still say stage 2.
  const partiallyEditedReport = buildValidReport();
  partiallyEditedReport.reconciliation.stages[0].stageNumber = 3;

  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: REAL_SERVICE_ROLE_JWT }, async () => {
    await withTempReportFile(partiallyEditedReport, async (fromReportPath) => {
      await assert.rejects(
        () => runApply(baseOptions({ fromReportPath, confirmStage: 3 }), { createClient: () => fakeClient }),
        /stage range.*must both equal --confirm-stage/s
      );
      assert.equal(rpcCallCount, 0);
    });
  });
});

// A minimal fake Supabase query builder covering only the read methods
// runDryRunReconcile's reconciliation path calls (select/eq/limit/
// maybeSingle, and plain awaited select via .then) — same shape as the fake
// used in grandtour-reconciliation-supabase.test.mjs. If runDryRunReconcile
// ever called .insert/.upsert/.update/.delete/.rpc, this fake would throw
// "not a function" and fail the test.
function fakeReadOnlySupabaseClient(tableData) {
  return {
    from(table) {
      const rows = tableData[table] ?? [];
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(column, value) { filters.push((row) => row[column] === value); return builder; },
        limit() { return builder; },
        async maybeSingle() {
          const match = rows.filter((row) => filters.every((predicate) => predicate(row)))[0] ?? null;
          return { data: match, error: null };
        },
        then(resolve) {
          const matches = rows.filter((row) => filters.every((predicate) => predicate(row)));
          return resolve({ data: matches, error: null });
        }
      };
      return builder;
    }
  };
}

function buildManualJsonPayloadFixture() {
  return {
    source_name: "manual-json",
    fetched_at: "2026-07-10T12:00:00.000Z",
    stage_results: [
      {
        stage_number: 2,
        riders: [{ position: 1, rider_name: "RIDER ONE", bib_number: 1, team_name: "Test Team", time: "1h 00' 00\"", gap: "-" }],
        jersey_holders: [
          { jerseyType: "yellow", sourceClassification: "individual", parsedRiderName: "RIDER ONE", parsedTeamName: "Test Team", bibNumber: 1 },
          { jerseyType: "green", sourceClassification: "points", parsedRiderName: "RIDER TWO", parsedTeamName: "Test Team", bibNumber: 2 },
          { jerseyType: "kom", sourceClassification: "climber", parsedRiderName: "RIDER THREE", parsedTeamName: "Test Team", bibNumber: 3 },
          { jerseyType: "white", sourceClassification: "youth", parsedRiderName: "RIDER FOUR", parsedTeamName: "Test Team", bibNumber: 4 }
        ]
      }
    ],
    stage_fetch_metadata: [],
    jersey_fetch_metadata: [],
    warnings: []
  };
}

function fourRiderFixtureRows() {
  return {
    grandtour_riders: [
      { id: "rider-1", grand_tour_id: "tour-1", team_id: "team-1", display_name: "Rider One", normalized_name: "rider one", bib_number: 1 },
      { id: "rider-2", grand_tour_id: "tour-1", team_id: "team-1", display_name: "Rider Two", normalized_name: "rider two", bib_number: 2 },
      { id: "rider-3", grand_tour_id: "tour-1", team_id: "team-1", display_name: "Rider Three", normalized_name: "rider three", bib_number: 3 },
      { id: "rider-4", grand_tour_id: "tour-1", team_id: "team-1", display_name: "Rider Four", normalized_name: "rider four", bib_number: 4 }
    ],
    grandtour_stage_startlists: [
      { stage_id: "stage-2", rider_id: "rider-1", status: "confirmed" },
      { stage_id: "stage-2", rider_id: "rider-2", status: "confirmed" },
      { stage_id: "stage-2", rider_id: "rider-3", status: "confirmed" },
      { stage_id: "stage-2", rider_id: "rider-4", status: "confirmed" }
    ]
  };
}

async function withManualJsonSourceFile(payload, fn) {
  const filePath = path.resolve("tmp", `manual-json-fixture-${Math.random().toString(36).slice(2)}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload), "utf8");
  try {
    return await fn(filePath);
  } finally {
    await fs.rm(filePath, { force: true });
  }
}

test("runDryRunReconcile (manual-json, reconcile: true) returns a review with a reconciled, safe-to-apply stage", async () => {
  await withManualJsonSourceFile(buildManualJsonPayloadFixture(), async (sourceFile) => {
    const fakeClient = fakeReadOnlySupabaseClient({
      grand_tours: [{ id: "tour-1", name: "Tour de France", year: 2026 }],
      grandtour_stages: [{ id: "stage-2", grand_tour_id: "tour-1", stage_number: 2, stage_type: "hilly", starts_at: "2026-07-05T10:00:00+00:00" }],
      grandtour_teams: [{ id: "team-1", grand_tour_id: "tour-1", name: "Test Team", short_name: "TT", code: "TT" }],
      ...fourRiderFixtureRows()
    });

    const review = await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: ANON_JWT }, () => runDryRunReconcile({
      provider: "manual-json",
      sourceFile,
      reconcile: true,
      grandTourName: "Tour de France",
      grandTourYear: 2026,
      fromStage: 2,
      toStage: 2
    }, { createClient: () => fakeClient }));

    assert.equal(review.mode, "dry-run");
    assert.equal(review.dryRun, true);
    assert.equal(review.applyEnabled, false);
    assert.equal(review.fetchedAt, "2026-07-10T12:00:00.000Z");
    assert.equal(review.reconciliation.overallSafeToApply, true);
    assert.equal(review.reconciliation.stages[0].stageNumber, 2);
    assert.equal(review.reconciliation.stages[0].safeToApply, true);
    assert.deepEqual(review.reconciliation.stages[0].blockers, []);
    assert.equal(review.reconciliation.stages[0].matchedRiders.length, 1);
    assert.equal(review.reconciliation.stages[0].jerseyHolders.length, 4);
  });
});

test("runDryRunReconcile (reconcile: false) never attaches a .reconciliation field and never touches Supabase", async () => {
  await withManualJsonSourceFile(buildManualJsonPayloadFixture(), async (sourceFile) => {
    const review = await runDryRunReconcile({
      provider: "manual-json",
      sourceFile,
      reconcile: false,
      fromStage: 2,
      toStage: 2
    }, { createClient: () => { throw new Error("should not be called when reconcile is false"); } });

    assert.equal(review.reconciliation, undefined);
  });
});

test("runDryRunReconcile rejects an unsupported provider", async () => {
  await assert.rejects(
    () => runDryRunReconcile({ provider: "some-other-feed", fromStage: 2, toStage: 2, reconcile: false }),
    /Unsupported provider: some-other-feed/
  );
});

test("runDryRunReconcile has no apply-related option: passing an apply flag does nothing and no apply RPC is ever called", async () => {
  await withManualJsonSourceFile(buildManualJsonPayloadFixture(), async (sourceFile) => {
    let rpcCallCount = 0;
    const fakeClient = Object.assign(
      fakeReadOnlySupabaseClient({
        grand_tours: [{ id: "tour-1", name: "Tour de France", year: 2026 }],
        grandtour_stages: [],
        grandtour_riders: [],
        grandtour_teams: [],
        grandtour_stage_startlists: []
      }),
      { async rpc() { rpcCallCount += 1; return { data: null, error: null }; } }
    );

    const review = await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: ANON_JWT }, () => runDryRunReconcile({
      provider: "manual-json",
      sourceFile,
      reconcile: true,
      apply: true, // deliberately set — runDryRunReconcile has no code path that reads this.
      grandTourName: "Tour de France",
      grandTourYear: 2026,
      fromStage: 2,
      toStage: 2
    }, { createClient: () => fakeClient }));

    assert.equal(review.applyEnabled, false);
    assert.equal(rpcCallCount, 0, "runDryRunReconcile must never call client.rpc(...) — it only ever runs .select() reads");
  });
});
