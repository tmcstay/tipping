import fs from "node:fs/promises";
import path from "node:path";

import { parseArgs as parseBaseArgs } from "./tdf-data-utils.mjs";

export const FEED_SEGMENTS = [
  "stage_metadata",
  "stage_result",
  "ttt_result",
  "jersey_holders",
  "rider_status",
  "startlist",
  "team_data"
];

export class ManualJsonGrandTourFeedProvider {
  constructor({ sourceFile }) {
    this.sourceFile = sourceFile;
    this.name = "manual-json";
  }

  async readPayload() {
    if (!this.sourceFile) {
      return {
        source_name: this.name,
        source_url: null,
        fetched_at: new Date().toISOString(),
        confidence: "manual",
        stage_results: [],
        ttt_results: [],
        jersey_holders: [],
        rider_statuses: [],
        startlist: [],
        teams: [],
        stage_metadata: []
      };
    }
    return JSON.parse(await fs.readFile(this.sourceFile, "utf8"));
  }

  async fetchStageResults() {
    const payload = await this.readPayload();
    return [...(payload.stage_results ?? []), ...(payload.ttt_results ?? [])];
  }

  async fetchJerseyHolders() {
    return (await this.readPayload()).jersey_holders ?? [];
  }

  async fetchRiderStatuses() {
    return (await this.readPayload()).rider_statuses ?? [];
  }

  async fetchStartlist() {
    return (await this.readPayload()).startlist ?? [];
  }
}

export function validateFeedPayload(payload) {
  const validationErrors = [];
  const stageResults = [...(payload.stage_results ?? []), ...(payload.ttt_results ?? [])];
  for (const result of stageResults) {
    if (!result.stage_id && !result.stage_number) {
      validationErrors.push("Stage result is missing stage_id or stage_number.");
    }
    if (result.type === "ttt" && (result.riders?.length ?? 0) > 0) {
      validationErrors.push("TTT stage result must use teams, not rider placings.");
    }
    if (result.type !== "ttt" && (result.teams?.length ?? 0) > 0) {
      validationErrors.push("Non-TTT stage result must use rider placings, not teams.");
    }
  }
  for (const status of payload.rider_statuses ?? []) {
    if (!status.rider_id && !status.rider_name) {
      validationErrors.push("Rider status row is missing rider_id or rider_name.");
    }
    if (!["active", "dns", "dnf", "otl", "withdrawn", "suspended", "excluded", "unknown"].includes(status.status)) {
      validationErrors.push(`Unsupported rider status: ${status.status}`);
    }
  }
  return validationErrors;
}

export function summarizeFeedPayload(payload) {
  const riderStatuses = payload.rider_statuses ?? [];
  const changedRiderStatuses = riderStatuses.filter((row) => row.status && row.status !== "active");
  const stageResults = payload.stage_results ?? [];
  const tttResults = payload.ttt_results ?? [];
  return {
    sourceName: payload.source_name ?? "manual-json",
    sourceUrl: payload.source_url ?? null,
    fetchedAt: payload.fetched_at ?? null,
    matchedRiders: 0,
    unmatchedRiders: riderStatuses.filter((row) => !row.rider_id).length,
    changedRiderStatuses: changedRiderStatuses.length,
    stageResultCandidates: stageResults.length,
    tttResultCandidates: tttResults.length,
    conflicts: [],
    segments: Object.fromEntries(FEED_SEGMENTS.map((segment) => [segment, 0]))
  };
}

export function buildFeedReview({ payload, mode }) {
  const validationErrors = validateFeedPayload(payload);
  return {
    mode,
    provider: payload.source_name ?? "manual-json",
    sourceUrl: payload.source_url ?? null,
    fetchedAt: payload.fetched_at ?? new Date().toISOString(),
    importStatus: validationErrors.length ? "failed" : mode === "apply" ? "validated" : "validated",
    validationErrors,
    summary: summarizeFeedPayload(payload),
    note: mode === "apply"
      ? "Apply mode currently validates and writes a review report only; production mutation requires explicit implementation against an approved provider."
      : "Dry run/review mode does not mutate database tables."
  };
}

export function parseFeedArgs(argv) {
  const options = {
    ...parseBaseArgs([]),
    apply: false,
    sourceFile: null,
    reportPath: path.resolve("data", "cycling", "grandtour_feed_review.json")
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--source-file") {
      options.sourceFile = path.resolve(argv[++index] ?? "");
      if (!options.sourceFile) throw new Error("--source-file requires a path");
    } else if (argument === "--report") {
      options.reportPath = path.resolve(argv[++index] ?? "");
      if (!options.reportPath) throw new Error("--report requires a path");
    } else if (argument !== "--dry-run") {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}
