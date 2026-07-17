import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMatchCoverageSummary,
  buildRegistryApplyPlan,
  classifyRegistryApplyAction,
  parseReportArgs,
  resolveQueueTypeForMatch,
  runReport,
} from "./tdf-2026-registry-match-report.mjs";

const FAKE_ANON_KEY = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.sig`;

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

test("parseReportArgs: defaults to writing files, no refresh", () => {
  const options = parseReportArgs([]);
  assert.equal(options.writeFiles, true);
  assert.equal(options.refreshCache, false);
});

test("parseReportArgs: --no-write-files/--refresh-cache toggle correctly", () => {
  const options = parseReportArgs(["--no-write-files", "--refresh-cache"]);
  assert.equal(options.writeFiles, false);
  assert.equal(options.refreshCache, true);
});

test("buildMatchCoverageSummary: tallies each match method independently, and unresolvedCount is computed directly (never drifts)", () => {
  const matches = [
    { matchedRiderId: "1", matchMethod: "uci_rider_id" },
    { matchedRiderId: "2", matchMethod: "canonical_name" },
    { matchedRiderId: "3", matchMethod: "alias" },
    { matchedRiderId: "4", matchMethod: "scored" },
    { matchedRiderId: null, matchMethod: null },
  ];
  const summary = buildMatchCoverageSummary(matches);
  assert.equal(summary.totalEntries, 5);
  assert.equal(summary.matchedTotal, 4);
  assert.equal(summary.unresolvedCount, 1);
  assert.equal(summary.byMethod.uci_rider_id, 1);
  assert.equal(summary.byMethod.canonical_name, 1);
  assert.equal(summary.byMethod.alias, 1);
  assert.equal(summary.byMethod.scored, 1);
  assert.equal(summary.matchRate, 0.8);
});

test("buildMatchCoverageSummary: an empty match set reports a zero match rate, not NaN or a throw", () => {
  const summary = buildMatchCoverageSummary([]);
  assert.equal(summary.totalEntries, 0);
  assert.equal(summary.matchRate, 0);
});

test("parseReportArgs: --apply/--confirm-production/--grand-tour-name/--grand-tour-year parse correctly, defaults otherwise", () => {
  const defaults = parseReportArgs([]);
  assert.equal(defaults.apply, false);
  assert.equal(defaults.confirmProduction, false);
  assert.equal(defaults.grandTourName, "Tour de France");
  assert.equal(defaults.grandTourYear, 2026);

  const options = parseReportArgs(["--apply", "--confirm-production", "--grand-tour-name", "GrandTour France 2026", "--grand-tour-year", "2026"]);
  assert.equal(options.apply, true);
  assert.equal(options.confirmProduction, true);
  assert.equal(options.grandTourName, "GrandTour France 2026");
  assert.equal(options.grandTourYear, 2026);
});

test("classifyRegistryApplyAction: unambiguous exact-identity methods (uci_rider_id/canonical_name/alias) auto-link", () => {
  for (const matchMethod of ["uci_rider_id", "canonical_name", "alias"]) {
    const match = { matchedRiderId: "r1", matchMethod, reviewRequired: false, reviewReason: null };
    assert.deepEqual(classifyRegistryApplyAction(match), { action: "link" });
  }
});

test("classifyRegistryApplyAction: a 'scored' match (inferred, not exact) is queued as ambiguous_candidate, never auto-linked", () => {
  const match = { matchedRiderId: "r1", matchMethod: "scored", reviewRequired: false, reviewReason: null };
  assert.deepEqual(classifyRegistryApplyAction(match), { action: "queue", queueType: "ambiguous_candidate" });
});

test("classifyRegistryApplyAction: an unmatched entry is queued as unmatched_startlist_rider", () => {
  const match = { matchedRiderId: null, matchMethod: null, reviewRequired: true, reviewReason: "unmatched_startlist_rider" };
  assert.deepEqual(classifyRegistryApplyAction(match), { action: "queue", queueType: "unmatched_startlist_rider" });
});

test("classifyRegistryApplyAction: an exact-method match still flagged reviewRequired (e.g. duplicate_uci_identity) is queued, not linked", () => {
  const match = { matchedRiderId: null, matchMethod: null, reviewRequired: true, reviewReason: "duplicate_uci_identity" };
  assert.deepEqual(classifyRegistryApplyAction(match), { action: "queue", queueType: "duplicate_uci_identity" });
});

test("resolveQueueTypeForMatch: maps every real reviewReason value onto a valid uci_rider_review_queue_type, folding the one non-enum case (unmatched_uci_rider_id) sensibly", () => {
  assert.equal(resolveQueueTypeForMatch({ reviewReason: "ambiguous_candidate" }), "ambiguous_candidate");
  assert.equal(resolveQueueTypeForMatch({ reviewReason: "dob_conflict" }), "dob_conflict");
  assert.equal(resolveQueueTypeForMatch({ reviewReason: "duplicate_uci_identity" }), "duplicate_uci_identity");
  assert.equal(resolveQueueTypeForMatch({ reviewReason: "low_confidence_alias_match" }), "low_confidence_alias_match");
  assert.equal(resolveQueueTypeForMatch({ reviewReason: "unmatched_startlist_rider" }), "unmatched_startlist_rider");
  assert.equal(resolveQueueTypeForMatch({ reviewReason: "unmatched_uci_rider_id" }), "unmatched_startlist_rider");
  assert.equal(resolveQueueTypeForMatch({ reviewReason: null, matchedRiderId: "r1" }), "ambiguous_candidate");
  assert.equal(resolveQueueTypeForMatch({ reviewReason: null, matchedRiderId: null }), "unmatched_startlist_rider");
});

test("buildRegistryApplyPlan: links an unambiguous match with an existing grandtour_riders row, queues a scored match, and skips an unambiguous match with no existing row", () => {
  const matches = [
    { entry: { entryName: "Tadej Pogacar", entryTeamName: "UAE", entryNationality: "SLO", entryBibNumber: 1 }, matchedRiderId: "uci-1", matchMethod: "canonical_name", confidence: "high", evidence: {}, reviewRequired: false, reviewReason: null },
    { entry: { entryName: "Jonas Vingegaard", entryTeamName: "Visma", entryNationality: "DEN", entryBibNumber: 11 }, matchedRiderId: "uci-2", matchMethod: "scored", confidence: "medium", evidence: { reasons: ["nationality_agrees"] }, reviewRequired: false, reviewReason: null },
    { entry: { entryName: "Nobody Registered", entryTeamName: "Team X", entryNationality: "FRA", entryBibNumber: 99 }, matchedRiderId: "uci-3", matchMethod: "canonical_name", confidence: "high", evidence: {}, reviewRequired: false, reviewReason: null },
  ];
  const grandTourRidersByNormalizedName = new Map([
    ["tadej pogacar", { id: "gt-1", display_name: "Tadej Pogacar", master_rider_id: null }],
    ["jonas vingegaard", { id: "gt-2", display_name: "Jonas Vingegaard", master_rider_id: null }],
  ]);

  const plan = buildRegistryApplyPlan(matches, grandTourRidersByNormalizedName);

  assert.equal(plan.toLink.length, 1);
  assert.equal(plan.toLink[0].grandtourRiderId, "gt-1");
  assert.equal(plan.toLink[0].uciRiderId, "uci-1");

  assert.equal(plan.toQueue.length, 1);
  assert.equal(plan.toQueue[0].queueType, "ambiguous_candidate");
  assert.equal(plan.toQueue[0].grandtourRiderId, "gt-2");
  assert.equal(plan.toQueue[0].riderId, "uci-2");

  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].reason, "no_grandtour_rider_row");
});

test("buildRegistryApplyPlan: an already-linked match is skipped, not re-linked", () => {
  const matches = [
    { entry: { entryName: "Tadej Pogacar" }, matchedRiderId: "uci-1", matchMethod: "canonical_name", confidence: "high", evidence: {}, reviewRequired: false, reviewReason: null },
  ];
  const grandTourRidersByNormalizedName = new Map([
    ["tadej pogacar", { id: "gt-1", display_name: "Tadej Pogacar", master_rider_id: "uci-1" }],
  ]);
  const plan = buildRegistryApplyPlan(matches, grandTourRidersByNormalizedName);
  assert.equal(plan.toLink.length, 0);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].reason, "already_linked");
});

test("runReport: reads the registry via the anon-key client only (read-only) and reports full match coverage against a fake letour roster + registry", async () => {
  await withEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: FAKE_ANON_KEY }, async () => {
    const canonicalRiders = [
      { id: "c1", uci_rider_id: "1", display_name: "Tadej Pogačar", normalized_name: "tadej pogacar", nationality: "SLO", current_team_name: "UAE Team Emirates XRG", date_of_birth: "1998-09-21" },
    ];
    const createClient = () => ({
      from(table) {
        return {
          select() { return this; },
          in() { return this; },
          then(resolve) {
            if (table === "uci_riders") return resolve({ data: canonicalRiders, error: null });
            if (table === "uci_rider_aliases") return resolve({ data: [], error: null });
            return resolve({ data: [], error: null });
          },
        };
      },
    });

    const fakeLetourHtml = "<section class=\"competitors\">"
      + "<h3 class=\"list__heading\"><a href=\"/en/team/UAD/uae\">UAE Team Emirates</a></h3><div class=\"list__box\">"
      + Array.from({ length: 8 }, (_, i) => `<span class="bib">${i + 1}</span><span class="runner"><span class="flag js-display-lazy" data-class="flag--slo"></span><a class="runner__link" href="/en/rider/${i + 1}">${i === 0 ? "Tadej Pogacar" : `Rider ${i + 1}`}</a></span>`).join("")
      + "</div>"
      + Array.from({ length: 22 }, (_, teamIndex) => `<h3 class="list__heading"><a href="/en/team/T${teamIndex}/team${teamIndex}">Team ${teamIndex}</a></h3><div class="list__box">`
        + Array.from({ length: 8 }, (_, i) => `<span class="bib">${100 + teamIndex * 8 + i}</span><span class="runner"><span class="flag js-display-lazy" data-class="flag--fra"></span><a class="runner__link" href="/en/rider/${100 + teamIndex * 8 + i}">Rider ${100 + teamIndex * 8 + i}</a></span>`).join("")
        + "</div>").join("")
      + "</section>";

    const fetchImpl = async () => ({ ok: true, status: 200, statusText: "OK", text: async () => fakeLetourHtml });

    const result = await runReport({ refreshCache: true, cacheDir: "tmp/tdf-2026-registry-match-report-test-cache" }, { createClient, fetchImpl });
    assert.equal(result.summary.totalEntries, 184);
    assert.ok(result.summary.byMethod.canonical_name >= 1, "the one seeded canonical rider (Tadej Pogacar) should match by canonical_name");
    assert.equal(result.registryRiderCount, 1);
  });
});
