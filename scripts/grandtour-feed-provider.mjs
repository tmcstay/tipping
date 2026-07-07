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

export function stageNumberFromResult(result) {
  const value = result?.stage_number;
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

export function buildStageRange(fromStage, toStage) {
  if (fromStage === null || toStage === null) return [];
  if (fromStage > toStage) return [];
  const range = [];
  for (let stage = fromStage; stage <= toStage; stage += 1) {
    range.push(stage);
  }
  return range;
}

export function uniqueSortedStageNumbers(stageResults, tttResults) {
  const seen = new Set();
  for (const result of [...(stageResults ?? []), ...(tttResults ?? [])]) {
    const stageNumber = stageNumberFromResult(result);
    if (stageNumber !== null) seen.add(stageNumber);
  }
  return [...seen].sort((a, b) => a - b);
}

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

export function summarizeFeedPayload(payload, options = {}) {
  const riderStatuses = payload.rider_statuses ?? [];
  const changedRiderStatuses = riderStatuses.filter((row) => row.status && row.status !== "active");
  const stageResults = payload.stage_results ?? [];
  const tttResults = payload.ttt_results ?? [];
  const jerseyHolders = payload.jersey_holders ?? [];

  const stageNumbers = uniqueSortedStageNumbers(stageResults, tttResults);
  const fromStage = options.importType === "backfill" ? options.fromStage : null;
  const toStage = options.importType === "backfill" ? options.toStage : null;
  const stagesConsidered = options.importType === "backfill"
    ? buildStageRange(fromStage, toStage)
    : stageNumbers;

  const stagesWithResults = stagesConsidered.filter((stage) => stageNumbers.includes(stage));
  const stagesMissingResults = stagesConsidered.filter((stage) => !stageNumbers.includes(stage));

  const unmatchedRidersInStageResults = stageResults
    .flatMap((result) => result.riders ?? [])
    .filter((row) => !row.rider_id).length;
  const unmatchedTeamsInTTTResults = tttResults
    .flatMap((result) => result.teams ?? [])
    .filter((row) => !row.team_id).length;

  return {
    sourceName: payload.source_name ?? "manual-json",
    sourceUrl: payload.source_url ?? null,
    fetchedAt: payload.fetched_at ?? null,
    matchedRiders: 0,
    unmatchedRiders: riderStatuses.filter((row) => !row.rider_id).length + unmatchedRidersInStageResults,
    unmatchedTeams: unmatchedTeamsInTTTResults,
    changedRiderStatuses: changedRiderStatuses.length,
    stageResultCandidates: stageResults.length,
    tttResultCandidates: tttResults.length,
    candidateJerseyHolderRows: jerseyHolders.length,
    candidateRiderStatusChanges: riderStatuses.length,
    stagesConsidered,
    stagesWithResults,
    stagesMissingResults,
    scoringStages: stagesWithResults,
    leaderboardRebuildRequired: options.importType === "backfill" || stagesWithResults.length > 1,
    conflicts: [],
    segments: Object.fromEntries(FEED_SEGMENTS.map((segment) => [segment, 0]))
  };
}

export function buildFeedReview({ payload, mode, options = {} }) {
  const importType = options.backfill || options.allCompleted ? "backfill" : "daily";
  const stageNumbers = uniqueSortedStageNumbers(payload.stage_results ?? [], payload.ttt_results ?? []);
  const inferredFromStage = importType === "backfill"
    ? options.fromStage ?? (options.allCompleted && stageNumbers.length ? stageNumbers[0] : null)
    : null;
  const inferredToStage = importType === "backfill"
    ? options.toStage ?? (options.allCompleted && stageNumbers.length ? stageNumbers[stageNumbers.length - 1] : null)
    : null;

  const validationErrors = validateFeedPayload(payload);
  const summary = summarizeFeedPayload(payload, {
    importType,
    fromStage: inferredFromStage,
    toStage: inferredToStage,
    allCompleted: options.allCompleted
  });

  const hasPendingIssues = summary.stagesMissingResults.length > 0 || summary.unmatchedRiders > 0 || summary.unmatchedTeams > 0;
  const importStatus = validationErrors.length
    ? "failed"
    : importType === "backfill" && hasPendingIssues
      ? "review_required"
      : "validated";

  return {
    mode,
    importType,
    fromStage: inferredFromStage,
    toStage: inferredToStage,
    provider: payload.source_name ?? "manual-json",
    sourceUrl: payload.source_url ?? null,
    fetchedAt: payload.fetched_at ?? new Date().toISOString(),
    importStatus,
    validationErrors,
    summary,
    note: mode === "apply"
      ? "Apply mode currently validates and writes a review report only; production mutation requires explicit implementation against an approved provider."
      : "Dry run/review mode does not mutate database tables."
  };
}

export function parseFeedArgs(argv) {
  const options = {
    ...parseBaseArgs([]),
    apply: false,
    provider: "manual-json",
    sourceFile: null,
    reportPath: path.resolve("data", "cycling", "grandtour_feed_review.json"),
    backfill: false,
    allCompleted: false,
    fromStage: null,
    toStage: null,
    confirmProduction: false,
    force: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--provider") {
      options.provider = argv[++index] ?? "";
      if (!options.provider) throw new Error("--provider requires a value");
    } else if (argument === "--source-file") {
      options.sourceFile = path.resolve(argv[++index] ?? "");
      if (!options.sourceFile) throw new Error("--source-file requires a path");
    } else if (argument === "--report") {
      options.reportPath = path.resolve(argv[++index] ?? "");
      if (!options.reportPath) throw new Error("--report requires a path");
    } else if (argument === "--backfill") {
      options.backfill = true;
    } else if (argument === "--all-completed") {
      options.allCompleted = true;
    } else if (argument === "--from-stage") {
      options.fromStage = Number(argv[++index] ?? "");
      if (!Number.isInteger(options.fromStage) || options.fromStage <= 0) {
        throw new Error("--from-stage requires a positive integer");
      }
    } else if (argument === "--to-stage") {
      options.toStage = Number(argv[++index] ?? "");
      if (!Number.isInteger(options.toStage) || options.toStage <= 0) {
        throw new Error("--to-stage requires a positive integer");
      }
    } else if (argument === "--confirm-production") {
      options.confirmProduction = true;
    } else if (argument === "--force") {
      options.force = true;
    } else if (argument !== "--dry-run") {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if ((options.fromStage !== null && options.toStage === null) || (options.fromStage === null && options.toStage !== null)) {
    throw new Error("--from-stage and --to-stage must be used together.");
  }

  if (options.backfill && !options.allCompleted && options.fromStage === null && options.toStage === null) {
    throw new Error("--backfill requires either --from-stage/--to-stage or --all-completed.");
  }

  return options;
}
