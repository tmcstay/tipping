import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildReportFileName,
  main,
  parseAutoDryRunArgs,
  resolveStageRange,
  summarizeAutoDryRunReport
} from "./grandtour-auto-dry-run.mjs";

test("parseAutoDryRunArgs applies documented defaults", () => {
  const options = parseAutoDryRunArgs([]);
  assert.equal(options.grandTourName, "Tour de France");
  assert.equal(options.grandTourYear, 2026);
  assert.equal(options.provider, "official-letour");
  assert.equal(options.stageNumber, null);
  assert.equal(options.fromStage, null);
  assert.equal(options.toStage, null);
  assert.equal(options.failOnUnsafe, true);
});

test("parseAutoDryRunArgs: --stage-number sets from/to to the same single stage", () => {
  const options = parseAutoDryRunArgs(["--stage-number", "5"]);
  assert.equal(options.fromStage, 5);
  assert.equal(options.toStage, 5);
});

test("parseAutoDryRunArgs: --from-stage/--to-stage set a range", () => {
  const options = parseAutoDryRunArgs(["--from-stage", "3", "--to-stage", "6"]);
  assert.equal(options.fromStage, 3);
  assert.equal(options.toStage, 6);
});

test("parseAutoDryRunArgs: --stage-number takes priority over --from-stage/--to-stage", () => {
  const options = parseAutoDryRunArgs(["--from-stage", "3", "--to-stage", "6", "--stage-number", "9"]);
  assert.equal(options.fromStage, 9);
  assert.equal(options.toStage, 9);
});

test("parseAutoDryRunArgs: --from-stage without --to-stage is rejected", () => {
  assert.throws(() => parseAutoDryRunArgs(["--from-stage", "3"]), /must both be provided together/);
});

test("parseAutoDryRunArgs: --to-stage before --from-stage is rejected", () => {
  assert.throws(() => parseAutoDryRunArgs(["--from-stage", "6", "--to-stage", "3"]), /--to-stage must be greater than or equal to --from-stage/);
});

test("parseAutoDryRunArgs: --fail-on-unsafe accepts true/false and rejects other values", () => {
  assert.equal(parseAutoDryRunArgs(["--fail-on-unsafe", "false"]).failOnUnsafe, false);
  assert.equal(parseAutoDryRunArgs(["--fail-on-unsafe", "true"]).failOnUnsafe, true);
  assert.throws(() => parseAutoDryRunArgs(["--fail-on-unsafe", "maybe"]), /requires 'true' or 'false'/);
});

test("parseAutoDryRunArgs rejects an unknown argument", () => {
  assert.throws(() => parseAutoDryRunArgs(["--nope"]), /Unknown argument: --nope/);
});

test("buildReportFileName includes provider, grand tour, single stage, and timestamp", () => {
  const name = buildReportFileName({
    provider: "official-letour",
    grandTourName: "Tour de France",
    grandTourYear: 2026,
    fromStage: 5,
    toStage: 5,
    timestamp: "2026-07-10T17:00:00.000Z"
  });
  assert.equal(name, "official-letour_tour-de-france-2026_stage-5_2026-07-10t17-00-00-000z.json");
});

test("buildReportFileName encodes a stage range as stages-N-to-M", () => {
  const name = buildReportFileName({
    provider: "official-letour",
    grandTourName: "Tour de France",
    grandTourYear: 2026,
    fromStage: 3,
    toStage: 6,
    timestamp: "2026-07-10T17:00:00.000Z"
  });
  assert.match(name, /^official-letour_tour-de-france-2026_stages-3-to-6_/);
});

function buildReport({ parserDriftDetected = false, overallSafeToApply = true, blockers = [] } = {}) {
  return {
    provider: "official-letour",
    fromStage: 5,
    toStage: 5,
    parserDriftDetected,
    stageFetchMetadata: [
      { stageNumber: 5, status: "ok", rowsMatched: 10, ridersParsed: 10 }
    ],
    jerseyFetchMetadata: [
      { stageNumber: 5, jerseyType: "yellow", status: "found" },
      { stageNumber: 5, jerseyType: "green", status: "found" }
    ],
    reconciliation: {
      overallSafeToApply,
      stages: [
        { stageNumber: 5, safeToApply: blockers.length === 0, matchedRiders: new Array(10).fill({}), jerseyHolders: new Array(4).fill({}), blockers }
      ]
    }
  };
}

test("summarizeAutoDryRunReport reports safe when there is no drift and safeToApply is true", () => {
  const summary = summarizeAutoDryRunReport(buildReport());
  assert.equal(summary.unsafe, false);
  assert.equal(summary.parserDriftDetected, false);
  assert.equal(summary.overallSafeToApply, true);
  assert.ok(summary.lines.some((line) => line.includes("result lines=10")));
  assert.ok(summary.lines.some((line) => line.includes("jersey holders=4")));
  assert.ok(summary.lines.some((line) => line.includes("yellow=found")));
});

test("summarizeAutoDryRunReport flags unsafe when parserDriftDetected is true", () => {
  const summary = summarizeAutoDryRunReport(buildReport({ parserDriftDetected: true }));
  assert.equal(summary.unsafe, true);
});

test("summarizeAutoDryRunReport flags unsafe when overallSafeToApply is false, and lists blockers", () => {
  const summary = summarizeAutoDryRunReport(buildReport({ overallSafeToApply: false, blockers: ["1 rider match(es) are ambiguous."] }));
  assert.equal(summary.unsafe, true);
  assert.ok(summary.lines.some((line) => line.includes("blocker: 1 rider match(es) are ambiguous.")));
});

test("summarizeAutoDryRunReport treats missing reconciliation as n/a, not unsafe", () => {
  const report = buildReport();
  delete report.reconciliation;
  const summary = summarizeAutoDryRunReport(report);
  assert.equal(summary.overallSafeToApply, null);
  assert.equal(summary.unsafe, false);
});

test("resolveStageRange returns the explicit range unchanged and never touches Supabase", async () => {
  const options = { fromStage: 5, toStage: 5 };
  const range = await resolveStageRange(options, { createClient: () => { throw new Error("should not be called"); } });
  assert.deepEqual(range, { fromStage: 5, toStage: 5, skippedReason: null });
});

function fakeSupabaseClient({ grandTourId, stageRows }) {
  return {
    from(table) {
      if (table === "grand_tours") {
        return {
          select() { return this; },
          eq() { return this; },
          limit() { return this; },
          async maybeSingle() {
            return { data: grandTourId ? { id: grandTourId } : null, error: null };
          }
        };
      }
      if (table === "grandtour_stages") {
        const builder = {
          select() { return builder; },
          eq() { return builder; },
          then(resolve) {
            return resolve({ data: stageRows, error: null });
          }
        };
        return builder;
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  };
}

test("resolveStageRange auto-resolves from grandtour_stages when no explicit stage is given", async () => {
  process.env.SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  try {
    const options = { fromStage: null, toStage: null, grandTourName: "Tour de France", grandTourYear: 2026, asOfDate: "2026-07-09" };
    const client = fakeSupabaseClient({
      grandTourId: "tour-1",
      stageRows: [{ stage_number: 6, starts_at: "2026-07-09T10:00:00+00:00" }]
    });
    const range = await resolveStageRange(options, { createClient: () => client });
    assert.deepEqual(range, { fromStage: 6, toStage: 6, skippedReason: null });
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  }
});

test("resolveStageRange is skipped (not an error) when no stage starts on the resolved date", async () => {
  process.env.SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  try {
    const options = { fromStage: null, toStage: null, grandTourName: "Tour de France", grandTourYear: 2026, asOfDate: "2026-07-14" };
    const client = fakeSupabaseClient({
      grandTourId: "tour-1",
      stageRows: [{ stage_number: 6, starts_at: "2026-07-09T10:00:00+00:00" }]
    });
    const range = await resolveStageRange(options, { createClient: () => client });
    assert.equal(range.fromStage, null);
    assert.match(range.skippedReason, /No grandtour_stages row starts on 2026-07-14/);
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
  }
});

test("resolveStageRange throws when neither SUPABASE_ANON_KEY nor SUPABASE_PUBLISHABLE_KEY is set", async () => {
  const originalUrl = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    await assert.rejects(
      () => resolveStageRange({ fromStage: null, toStage: null, grandTourName: "Tour de France", grandTourYear: 2026 }, {}),
      /requires SUPABASE_URL and SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY/
    );
  } finally {
    if (originalUrl !== undefined) process.env.SUPABASE_URL = originalUrl;
  }
});

// A fake spawnSync that simulates grandtour-feed-import.mjs by writing the
// given report synchronously to whatever --report path it was called with,
// exactly like the real subprocess (invoked with stdio: "inherit", so
// main() always reads the report back from disk rather than from stdout).
function fakeSpawnSyncWriting(report, { captureArgs } = {}) {
  return (command, args) => {
    captureArgs?.(args);
    const reportPath = args[args.indexOf("--report") + 1];
    writeFileSync(reportPath, JSON.stringify(report), "utf8");
    return { status: 0, error: null };
  };
}

test("main never passes --apply to grandtour-feed-import.mjs, writes the report, and returns a summary", async () => {
  const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), "grandtour-auto-dry-run-"));
  let capturedArgs = null;
  try {
    const result = await main(["--stage-number", "5", "--report-dir", reportDir], {
      spawnSync: fakeSpawnSyncWriting(buildReport(), { captureArgs: (args) => { capturedArgs = args; } })
    });

    assert.equal(result.skipped, false);
    assert.equal(result.summary.unsafe, false);
    assert.ok(capturedArgs.includes("--reconcile"));
    assert.ok(!capturedArgs.includes("--apply"));
    assert.ok(capturedArgs.includes("--from-stage"));
    assert.ok(capturedArgs.includes("--to-stage"));
    const reportPath = capturedArgs[capturedArgs.indexOf("--report") + 1];
    assert.ok(reportPath.startsWith(reportDir));
  } finally {
    await fs.rm(reportDir, { recursive: true, force: true });
  }
});

test("main throws when the report is unsafe and fail_on_unsafe is true", async () => {
  const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), "grandtour-auto-dry-run-"));
  try {
    await assert.rejects(
      () => main(["--stage-number", "5", "--report-dir", reportDir], {
        spawnSync: fakeSpawnSyncWriting(buildReport({ overallSafeToApply: false, blockers: ["blocked"] }))
      }),
      /GrandTour auto dry-run report is unsafe/
    );
  } finally {
    await fs.rm(reportDir, { recursive: true, force: true });
  }
});

test("main completes without throwing when the report is unsafe but fail_on_unsafe is false", async () => {
  const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), "grandtour-auto-dry-run-"));
  try {
    const result = await main(["--stage-number", "5", "--report-dir", reportDir, "--fail-on-unsafe", "false"], {
      spawnSync: fakeSpawnSyncWriting(buildReport({ overallSafeToApply: false, blockers: ["blocked"] }))
    });
    assert.equal(result.summary.unsafe, true);
  } finally {
    await fs.rm(reportDir, { recursive: true, force: true });
  }
});

test("main is skipped (not an error) when the resolved stage range yields no stage", async () => {
  process.env.SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  try {
    let spawned = false;
    const client = fakeSupabaseClient({ grandTourId: "tour-1", stageRows: [] });
    const result = await main(["--as-of-date", "2026-07-14"], {
      createClient: () => client,
      spawnSync: () => { spawned = true; return { status: 0, error: null }; }
    });
    assert.equal(result.skipped, true);
    assert.equal(spawned, false);
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  }
});
