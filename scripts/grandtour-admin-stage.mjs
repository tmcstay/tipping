import { pathToFileURL } from "node:url";

import { decodeJwtRole, isProductionSupabaseUrl } from "./grandtour-apply.mjs";
import { resolveGrandTourId } from "./grandtour-reconciliation-supabase.mjs";

/**
 * Admin CLI for the GrandTour review workflow: apply (draft/imported) ->
 * mark-checked (admin_checked) -> finalise (finalised) -> score. Replaces
 * hand-running mark_grandtour_stage_result_checked/
 * finalize_grandtour_stage_result/recalculate_grandtour_stage_scores
 * directly in the SQL editor. This script never fetches letour.fr, never
 * runs apply, and never writes to any table directly — every mutation goes
 * through one of the three named RPCs.
 *
 * mark_grandtour_stage_result_checked and finalize_grandtour_stage_result
 * are service_role-only RPCs that take an explicit p_checked_by/
 * p_finalized_by uuid, so --mark-checked/--finalise use
 * SUPABASE_SERVICE_ROLE_KEY, matching --apply's convention.
 * recalculate_grandtour_stage_scores is `security invoker` and checks
 * auth.uid() directly - it cannot be called with the service-role key as a
 * given admin. --score instead signs in as SUPABASE_ADMIN_EMAIL/
 * SUPABASE_ADMIN_PASSWORD via the anon key to get a real session, and
 * refuses to proceed unless that session's user id matches --admin-user, so
 * the audit trail's checked-by/finalised-by/acting-scorer identities can
 * never silently diverge from the caller's stated identity. The
 * service-role client and the authenticated-admin client are never reused
 * for each other's purpose.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COMMAND_FLAGS = {
  "--mark-checked": "mark-checked",
  "--finalise": "finalise",
  "--finalize": "finalise",
  "--score": "score",
  "--check-finalise-score": "check-finalise-score",
  "--check-finalize-score": "check-finalise-score"
};

const USAGE = `Usage: node scripts/grandtour-admin-stage.mjs <command> --stage <n> --admin-user <uuid> [options]

Commands (exactly one required):
  --mark-checked            Run mark_grandtour_stage_result_checked
  --finalise, --finalize    Run finalize_grandtour_stage_result
  --score                   Run recalculate_grandtour_stage_scores
  --check-finalise-score    Run all three in sequence, each with its own fresh preflight

Options:
  --stage <n>                    Stage number (required)
  --grand-tour-name <name>       Default "Tour de France"
  --grand-tour-year <year>       Default 2026
  --admin-user <uuid>            Acting admin's auth.users id (required)
  --confirm-production           Required to write against a known production Supabase URL
  --note <text>                  Passed as p_note to mark-checked
  --reason <text>                Passed as p_reason to finalise/score
  --request-id <text>            Optional; a stable timestamped id is generated per phase otherwise
  --recalculate                  Required to re-run --score when the stage already has score rows
  --help                         Show this message

Env vars:
  SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL)          Always required
  SUPABASE_SERVICE_ROLE_KEY                           Required for --mark-checked/--finalise/--check-finalise-score
  SUPABASE_ANON_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY)  Required for --score/--check-finalise-score
  SUPABASE_ADMIN_EMAIL                                Required for --score/--check-finalise-score
  SUPABASE_ADMIN_PASSWORD                             Required for --score/--check-finalise-score
`;

export function parseAdminStageArgs(argv) {
  const options = {
    command: null,
    help: false,
    stageNumber: null,
    grandTourName: "Tour de France",
    grandTourYear: 2026,
    adminUser: null,
    confirmProduction: false,
    note: null,
    reason: null,
    requestId: null,
    recalculate: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (Object.prototype.hasOwnProperty.call(COMMAND_FLAGS, argument)) {
      const resolved = COMMAND_FLAGS[argument];
      if (options.command !== null && options.command !== resolved) {
        throw new Error(`Only one command flag may be given (already have a flag resolving to ${JSON.stringify(options.command)}, also got ${JSON.stringify(argument)}).`);
      }
      options.command = resolved;
    } else if (argument === "--stage") {
      const raw = argv[++index];
      options.stageNumber = Number(raw ?? "");
      if (!Number.isInteger(options.stageNumber) || options.stageNumber <= 0) {
        throw new Error(`--stage requires a positive integer (got ${JSON.stringify(raw)}).`);
      }
    } else if (argument === "--grand-tour-name") {
      options.grandTourName = argv[++index] ?? "";
      if (!options.grandTourName) throw new Error("--grand-tour-name requires a value.");
    } else if (argument === "--grand-tour-year") {
      const raw = argv[++index];
      options.grandTourYear = Number(raw ?? "");
      if (!Number.isInteger(options.grandTourYear) || options.grandTourYear <= 0) {
        throw new Error(`--grand-tour-year requires a positive integer (got ${JSON.stringify(raw)}).`);
      }
    } else if (argument === "--admin-user") {
      options.adminUser = argv[++index] ?? "";
      if (!UUID_PATTERN.test(options.adminUser)) {
        throw new Error(`--admin-user requires a UUID (got ${JSON.stringify(options.adminUser)}).`);
      }
    } else if (argument === "--confirm-production") {
      options.confirmProduction = true;
    } else if (argument === "--note") {
      options.note = argv[++index] ?? "";
    } else if (argument === "--reason") {
      options.reason = argv[++index] ?? "";
    } else if (argument === "--request-id") {
      const raw = argv[++index] ?? "";
      if (!raw) throw new Error("--request-id requires a value.");
      options.requestId = raw;
    } else if (argument === "--recalculate") {
      options.recalculate = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unrecognized argument: ${argument}`);
    }
  }

  if (options.help) return options;

  if (options.command === null) {
    throw new Error("Exactly one command flag is required: --mark-checked, --finalise (or --finalize), --score, or --check-finalise-score (or --check-finalize-score).");
  }
  if (options.stageNumber === null) {
    throw new Error("--stage <stage_number> is required.");
  }
  if (!options.adminUser) {
    throw new Error("--admin-user <uuid> is required.");
  }

  return options;
}

export function buildRequestId(command, stageNumber, now = new Date()) {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `${command}-stage${stageNumber}-${timestamp}`;
}

function phaseRequestId(baseRequestId, phase, stageNumber) {
  if (baseRequestId) return `${baseRequestId}-${phase}`;
  return buildRequestId(phase, stageNumber);
}

/**
 * Every precondition below is checked against fresh, single-table queries
 * only (never a query joined against another child table), so
 * result_line_count/jersey_holder_count/score_count/*_score_awarded can
 * never be inflated by an unrelated table's row count - see
 * fetchStageState below for the query shapes this depends on.
 */
export function validateMarkCheckedPreflight(state) {
  const errors = [];
  if (!state.resultExists) {
    errors.push("No draft/imported grandtour_stage_results row exists for this stage; apply the official feed result first.");
    return { errors };
  }
  if (state.isFinal) errors.push("Stage result is already final (is_final=true); a final result cannot be re-checked.");
  if (state.lineCount !== 10) errors.push(`Expected exactly 10 result lines for a non-TTT stage, found ${state.lineCount}.`);
  if (state.jerseyCount !== 4) errors.push(`Expected exactly 4 jersey holders for a non-TTT stage, found ${state.jerseyCount}.`);
  if (state.scoreCount !== 0) errors.push(`Expected 0 score rows before admin-check, found ${state.scoreCount}.`);
  return { errors };
}

export function validateFinalisePreflight(state) {
  const errors = [];
  if (!state.resultExists) {
    errors.push("No draft/imported grandtour_stage_results row exists for this stage; apply and --mark-checked first.");
    return { errors };
  }
  if (state.reviewStatus !== "admin_checked") {
    errors.push(`review_status must be "admin_checked" before finalising, found ${JSON.stringify(state.reviewStatus)}. Run --mark-checked first.`);
  }
  if (state.isFinal) errors.push("Stage result is already final (is_final=true).");
  if (state.lineCount !== 10) errors.push(`Expected exactly 10 result lines for a non-TTT stage, found ${state.lineCount}.`);
  if (state.jerseyCount !== 4) errors.push(`Expected exactly 4 jersey holders for a non-TTT stage, found ${state.jerseyCount}.`);
  if (state.scoreCount !== 0) errors.push(`Expected 0 score rows before finalising, found ${state.scoreCount}.`);
  return { errors };
}

export function validateScorePreflight(state, { recalculate = false } = {}) {
  const errors = [];
  if (!state.resultExists) {
    errors.push("No grandtour_stage_results row exists for this stage; apply, --mark-checked and --finalise first.");
    return { errors };
  }
  if (state.reviewStatus !== "finalised") {
    errors.push(`review_status must be "finalised" before scoring, found ${JSON.stringify(state.reviewStatus)}. Run --finalise first.`);
  }
  if (!state.isFinal) errors.push("Stage result must be final (is_final=true) before scoring.");
  if (state.lineCount !== 10) errors.push(`Expected exactly 10 result lines for a non-TTT stage, found ${state.lineCount}.`);
  if (state.jerseyCount !== 4) errors.push(`Expected exactly 4 jersey holders for a non-TTT stage, found ${state.jerseyCount}.`);
  if (state.scoreCount > 0 && !recalculate) {
    errors.push(`Stage already has ${state.scoreCount} score row(s); pass --recalculate to intentionally recompute scores. Refusing to silently rescore.`);
  }
  return { errors };
}

export function buildSummary(stage, state) {
  return {
    stage_number: stage.stageNumber,
    stage_id: stage.stageId,
    stage_result_id: state.resultId,
    is_final: state.isFinal,
    review_status: state.reviewStatus,
    result_line_count: state.lineCount,
    jersey_holder_count: state.jerseyCount,
    score_count: state.scoreCount,
    total_score_awarded: state.totalScoreAwarded,
    top5_score_awarded: state.top5ScoreAwarded,
    jersey_score_awarded: state.jerseyScoreAwarded,
    bonus_score_awarded: state.bonusScoreAwarded
  };
}

function assertProductionConfirmed(url, options) {
  if (isProductionSupabaseUrl(url) && !options.confirmProduction) {
    throw new Error(`SUPABASE_URL (${url}) resolves to a known production project. Re-run with --confirm-production to proceed.`);
  }
}

async function resolveServiceClient(options, deps) {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("This command requires SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  }
  const keyRole = decodeJwtRole(serviceRoleKey);
  if (keyRole !== "service_role") {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY decodes to role ${JSON.stringify(keyRole)}, not "service_role". Refusing to run with a non-service-role key.`);
  }
  assertProductionConfirmed(url, options);
  const createClient = deps.createClient ?? (await import("@supabase/supabase-js")).createClient;
  const client = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return { url, client };
}

/**
 * Signs in as SUPABASE_ADMIN_EMAIL/SUPABASE_ADMIN_PASSWORD via the anon key
 * and refuses to proceed unless the resulting session's user id matches
 * --admin-user exactly - this is the only thing standing between "scoring
 * as one user" and "the audit trail claiming a different user checked or
 * finalised", since recalculate_grandtour_stage_scores takes no user-id
 * parameter of its own and relies entirely on auth.uid().
 */
async function resolveAdminClient(options, deps) {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const adminEmail = process.env.SUPABASE_ADMIN_EMAIL;
  const adminPassword = process.env.SUPABASE_ADMIN_PASSWORD;

  const missing = [];
  if (!url) missing.push("SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL)");
  if (!anonKey) missing.push("SUPABASE_ANON_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY)");
  if (!adminEmail) missing.push("SUPABASE_ADMIN_EMAIL");
  if (!adminPassword) missing.push("SUPABASE_ADMIN_PASSWORD");
  if (missing.length > 0) {
    throw new Error(`--score requires an authenticated cycling-admin session (recalculate_grandtour_stage_scores checks auth.uid(), not a service-role key). Missing: ${missing.join(", ")}.`);
  }

  assertProductionConfirmed(url, options);

  const createClient = deps.createClient ?? (await import("@supabase/supabase-js")).createClient;
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data, error } = await client.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
  if (error) {
    throw new Error(`--score could not sign in as SUPABASE_ADMIN_EMAIL (${adminEmail}): ${error.message}`);
  }
  const sessionUserId = data.user?.id ?? null;
  if (!sessionUserId) {
    throw new Error("--score sign-in did not return a user id.");
  }
  if (sessionUserId !== options.adminUser) {
    throw new Error(`--score refuses to proceed: the authenticated admin (user id ${sessionUserId}) does not match --admin-user (${options.adminUser}). This check exists so the audit trail's checked-by/finalised-by/acting-scorer identities can never silently diverge.`);
  }

  return { url, client };
}

async function getServiceClient(options, deps) {
  if (deps.serviceClient) return deps.serviceClient;
  return (await resolveServiceClient(options, deps)).client;
}

async function getAdminClient(options, deps) {
  if (deps.adminClient) return deps.adminClient;
  return (await resolveAdminClient(options, deps)).client;
}

export async function resolveStage(client, { grandTourName, grandTourYear, stageNumber }) {
  const grandTourId = await resolveGrandTourId(client, { name: grandTourName, year: grandTourYear });
  if (!grandTourId) {
    throw new Error(`No grand_tours record found for name=${JSON.stringify(grandTourName)} year=${grandTourYear}. Pass --grand-tour-name/--grand-tour-year explicitly if it uses different values.`);
  }

  const { data: stage, error } = await client
    .from("grandtour_stages")
    .select("id, stage_number, stage_type")
    .eq("grand_tour_id", grandTourId)
    .eq("stage_number", stageNumber)
    .maybeSingle();
  if (error) throw error;
  if (!stage) {
    throw new Error(`No grandtour_stages row found for stage ${stageNumber} of ${grandTourName} ${grandTourYear}.`);
  }
  if (["team_time_trial", "ttt"].includes(stage.stage_type)) {
    throw new Error(`Stage ${stageNumber} is a TTT stage (stage_type=${stage.stage_type}); --mark-checked/--finalise/--score are not supported for TTT stages by this CLI (the underlying RPCs refuse them too).`);
  }

  return { grandTourId, stageId: stage.id, stageNumber: stage.stage_number, stageType: stage.stage_type };
}

/**
 * Fetches every count/sum this CLI needs from four separate, single-table
 * queries: grandtour_stage_results (one row), grandtour_stage_result_lines
 * (a head count scoped by stage_result_id), grandtour_stage_jersey_holders
 * (a head count scoped by stage_id), and grandtour_stage_scores (a plain
 * row select scoped by stage_id, summed client-side). None of these queries
 * joins another child table, so result_line_count/jersey_holder_count/
 * score_count/*_score_awarded can never be multiplied by an unrelated
 * table's matching row count - the exact bug class this function exists to
 * avoid.
 */
export async function fetchStageState(client, { stageId }) {
  const { data: result, error: resultError } = await client
    .from("grandtour_stage_results")
    .select("id, is_final, review_status")
    .eq("stage_id", stageId)
    .maybeSingle();
  if (resultError) throw resultError;

  let lineCount = 0;
  if (result) {
    const { count, error: lineError } = await client
      .from("grandtour_stage_result_lines")
      .select("id", { count: "exact", head: true })
      .eq("stage_result_id", result.id);
    if (lineError) throw lineError;
    lineCount = count ?? 0;
  }

  const { count: jerseyCount, error: jerseyError } = await client
    .from("grandtour_stage_jersey_holders")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", stageId);
  if (jerseyError) throw jerseyError;

  const { data: scoreRows, error: scoreError } = await client
    .from("grandtour_stage_scores")
    .select("total_score, top5_score, jersey_score, bonus_score")
    .eq("stage_id", stageId);
  if (scoreError) throw scoreError;

  const sums = (scoreRows ?? []).reduce(
    (acc, row) => ({
      totalScoreAwarded: acc.totalScoreAwarded + (row.total_score ?? 0),
      top5ScoreAwarded: acc.top5ScoreAwarded + (row.top5_score ?? 0),
      jerseyScoreAwarded: acc.jerseyScoreAwarded + (row.jersey_score ?? 0),
      bonusScoreAwarded: acc.bonusScoreAwarded + (row.bonus_score ?? 0)
    }),
    { totalScoreAwarded: 0, top5ScoreAwarded: 0, jerseyScoreAwarded: 0, bonusScoreAwarded: 0 }
  );

  return {
    resultExists: Boolean(result),
    resultId: result?.id ?? null,
    isFinal: result?.is_final ?? false,
    reviewStatus: result?.review_status ?? null,
    lineCount,
    jerseyCount: jerseyCount ?? 0,
    scoreCount: (scoreRows ?? []).length,
    ...sums
  };
}

function printOutcome({ command, stage, rpcResponse, summary }) {
  console.log(JSON.stringify({ command, stage_number: stage.stageNumber, stage_id: stage.stageId, rpc_response: rpcResponse, summary }, null, 2));
}

export async function runMarkChecked(options, deps = {}) {
  const client = await getServiceClient(options, deps);
  const stage = await resolveStage(client, options);
  const before = await fetchStageState(client, { stageId: stage.stageId });

  if (before.resultExists && before.reviewStatus === "admin_checked") {
    console.log(`Stage ${stage.stageNumber} is already admin_checked; mark_grandtour_stage_result_checked is idempotent, re-running to refresh the check note/timestamp (no-change in effect).`);
  }

  const { errors } = validateMarkCheckedPreflight(before);
  if (errors.length > 0) {
    throw new Error(`--mark-checked preflight failed for stage ${stage.stageNumber}:\n- ${errors.join("\n- ")}`);
  }

  const requestId = options.requestId ?? buildRequestId("mark-checked", stage.stageNumber);
  const { data, error } = await client.rpc("mark_grandtour_stage_result_checked", {
    p_stage_id: stage.stageId,
    p_checked_by: options.adminUser,
    p_note: options.note ?? null,
    p_request_id: requestId
  });
  if (error) throw new Error(`mark_grandtour_stage_result_checked failed: ${error.message}`);

  const after = await fetchStageState(client, { stageId: stage.stageId });
  const summary = buildSummary(stage, after);
  printOutcome({ command: "mark-checked", stage, rpcResponse: data, summary });
  return { stage, rpcResponse: data, summary };
}

export async function runFinalise(options, deps = {}) {
  const client = await getServiceClient(options, deps);
  const stage = await resolveStage(client, options);
  const before = await fetchStageState(client, { stageId: stage.stageId });

  if (!before.resultExists) {
    throw new Error(`--finalise preflight failed for stage ${stage.stageNumber}: no draft/imported grandtour_stage_results row exists; apply and --mark-checked first.`);
  }

  if (before.isFinal) {
    console.log(`Stage ${stage.stageNumber} is already finalised; finalize_grandtour_stage_result is idempotent and is expected to return status "no_change".`);
  } else {
    const { errors } = validateFinalisePreflight(before);
    if (errors.length > 0) {
      throw new Error(`--finalise preflight failed for stage ${stage.stageNumber}:\n- ${errors.join("\n- ")}`);
    }
  }

  const requestId = options.requestId ?? buildRequestId("finalise", stage.stageNumber);
  const { data, error } = await client.rpc("finalize_grandtour_stage_result", {
    p_stage_id: stage.stageId,
    p_finalized_by: options.adminUser,
    p_reason: options.reason ?? null,
    p_request_id: requestId
  });
  if (error) throw new Error(`finalize_grandtour_stage_result failed: ${error.message}`);

  const after = await fetchStageState(client, { stageId: stage.stageId });
  const summary = buildSummary(stage, after);
  printOutcome({ command: "finalise", stage, rpcResponse: data, summary });
  return { stage, rpcResponse: data, summary };
}

export async function runScore(options, deps = {}) {
  const client = await getAdminClient(options, deps);
  const stage = await resolveStage(client, options);
  const before = await fetchStageState(client, { stageId: stage.stageId });

  const { errors } = validateScorePreflight(before, { recalculate: options.recalculate });
  if (errors.length > 0) {
    throw new Error(`--score preflight failed for stage ${stage.stageNumber}:\n- ${errors.join("\n- ")}`);
  }

  const requestId = options.requestId ?? buildRequestId("score", stage.stageNumber);
  const { data, error } = await client.rpc("recalculate_grandtour_stage_scores", {
    p_stage_id: stage.stageId,
    p_reason: options.reason ?? null,
    p_request_id: requestId
  });
  if (error) throw new Error(`recalculate_grandtour_stage_scores failed: ${error.message}`);

  const after = await fetchStageState(client, { stageId: stage.stageId });
  const summary = buildSummary(stage, after);
  const rpcResponse = { tips_affected: data };
  printOutcome({ command: "score", stage, rpcResponse, summary });
  return { stage, rpcResponse, summary };
}

/**
 * Runs mark-checked, finalise and score in sequence. Both clients (the
 * service-role client for mark-checked/finalise and the authenticated-admin
 * client for score) are resolved up front, before any RPC is called, so a
 * missing/invalid credential is caught before any write happens rather than
 * after mark-checked and finalise have already succeeded. Each phase still
 * runs its own full preflight immediately before its own RPC call (via
 * runMarkChecked/runFinalise/runScore's own fresh fetchStageState), not a
 * single preflight computed once at the start - so a state change between
 * phases (e.g. another operator racing this one) is still caught.
 */
export async function runCheckFinaliseScore(options, deps = {}) {
  const serviceClient = deps.serviceClient ?? (await resolveServiceClient(options, deps)).client;
  const adminClient = deps.adminClient ?? (await resolveAdminClient(options, deps)).client;

  const markChecked = await runMarkChecked(
    { ...options, requestId: phaseRequestId(options.requestId, "mark-checked", options.stageNumber) },
    { ...deps, serviceClient }
  );
  const finalise = await runFinalise(
    { ...options, requestId: phaseRequestId(options.requestId, "finalise", options.stageNumber) },
    { ...deps, serviceClient }
  );
  const score = await runScore(
    { ...options, requestId: phaseRequestId(options.requestId, "score", options.stageNumber) },
    { ...deps, adminClient }
  );

  return { markChecked, finalise, score };
}

async function main() {
  const options = parseAdminStageArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  switch (options.command) {
    case "mark-checked":
      await runMarkChecked(options);
      break;
    case "finalise":
      await runFinalise(options);
      break;
    case "score":
      await runScore(options);
      break;
    case "check-finalise-score":
      await runCheckFinaliseScore(options);
      break;
    default:
      throw new Error(`Unhandled command: ${options.command}`);
  }
}

export { main };

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
