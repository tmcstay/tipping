/**
 * POST /api/admin/grandtour/apply-official-result
 *
 * Server-side (Vercel Node serverless function) endpoint backing the admin
 * UI's per-stage "Apply Official Result" button
 * (components/GrandTourStageAdminCard.tsx). Fetches a FRESH dry-run +
 * reconcile for the requested stage (never trusts a client-supplied
 * report), validates it exactly like the CLI's --apply path does, and - if
 * safe - calls apply_grandtour_official_stage_result() using the CALLER'S
 * OWN authenticated session, never a service-role key.
 *
 * This route:
 *   - NEVER finalises or scores. Writes a DRAFT result only (is_final=false),
 *     exactly like the CLI's --apply.
 *   - NEVER uses SUPABASE_SERVICE_ROLE_KEY, anywhere. The apply RPC itself
 *     was extended (supabase/migrations/20260714010000_grandtour_apply_authenticated_grant.sql)
 *     to accept `service_role OR grandtour_private.is_cycling_admin()` -
 *     this route always calls it as the caller's own session, so the write
 *     happens under the SAME authorization the RPC itself checks
 *     server-side (defense in depth: even if this route's own admin check
 *     below were somehow bypassed, the RPC's internal guard still refuses
 *     a non-admin caller).
 *   - Requires a real signed-in session AND cycling-admin membership,
 *     verified via public.is_current_user_cycling_admin() - same as
 *     run-official-check.mjs. Anonymous callers get 401; non-admins get 403.
 *   - Only accepts provider "official-letour" for now.
 *   - Refuses to apply (422) if the freshly-fetched report is not safe -
 *     it re-validates with the exact same validateReportForApply/
 *     selectTopNRows/mapRowsToResultLines/selectJerseyHolderParams
 *     functions the CLI uses (scripts/grandtour-apply.mjs), so this route
 *     can never apply something the CLI path would refuse.
 */

import { runDryRunReconcile } from "../../../../../scripts/grandtour-feed-import.mjs";
import {
  buildApplyRpcParams,
  interpretRpcResponse,
  mapRowsToResultLines,
  selectJerseyHolderParams,
  selectTopNRows,
  validateReportForApply
} from "../../../../../scripts/grandtour-apply.mjs";

const ALLOWED_PROVIDERS = new Set(["official-letour"]);

function getSupabasePublicCredentials() {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY
    ?? process.env.SUPABASE_PUBLISHABLE_KEY
    ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return { url, anonKey };
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function extractBearerToken(req) {
  const header = req.headers?.authorization ?? req.headers?.Authorization ?? "";
  if (typeof header !== "string" || !header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(header.indexOf(" ") + 1).trim();
  return token || null;
}

/**
 * Exported separately from the default export so tests can call it
 * directly with a fake req/res and injected deps (`deps.createClient`,
 * `deps.runDryRunReconcile`) - no real network, Supabase, or letour.fr
 * call happens in tests.
 */
export async function handleApplyOfficialResult(req, res, deps = {}) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed. Use POST." });
    return;
  }

  const accessToken = extractBearerToken(req);
  if (!accessToken) {
    sendJson(res, 401, { ok: false, error: "Missing or invalid Authorization header. Sign in and retry." });
    return;
  }

  const { url, anonKey } = getSupabasePublicCredentials();
  if (!url || !anonKey) {
    sendJson(res, 500, { ok: false, error: "Server is not configured with SUPABASE_URL and SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY." });
    return;
  }

  const createClient = deps.createClient ?? (await import("@supabase/supabase-js")).createClient;
  // Scoped to the caller's own session for BOTH the admin check and the
  // apply RPC call itself - this client's Authorization header is the
  // admin's own access token throughout, never a service-role key.
  const authedClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: userData, error: userError } = await authedClient.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    sendJson(res, 401, { ok: false, error: "Not signed in, or your session has expired." });
    return;
  }

  const { data: isAdmin, error: adminCheckError } = await authedClient.rpc("is_current_user_cycling_admin");
  if (adminCheckError) {
    sendJson(res, 500, { ok: false, error: "Could not verify admin status." });
    return;
  }
  if (isAdmin !== true) {
    sendJson(res, 403, { ok: false, error: "You do not have cycling admin access." });
    return;
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const grandTourName = typeof body.grandTourName === "string" && body.grandTourName.trim() ? body.grandTourName : "Tour de France";
  const grandTourYear = Number.isInteger(body.grandTourYear) ? body.grandTourYear : Number(body.grandTourYear ?? 2026);
  const provider = typeof body.provider === "string" && body.provider ? body.provider : "official-letour";
  const stageNumber = Number(body.stageNumber);
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

  if (!ALLOWED_PROVIDERS.has(provider)) {
    sendJson(res, 400, { ok: false, error: `Unsupported provider: "${provider}". Only "official-letour" is allowed.` });
    return;
  }
  if (!Number.isInteger(stageNumber) || stageNumber <= 0) {
    sendJson(res, 400, { ok: false, error: "stageNumber must be a positive integer." });
    return;
  }
  if (!Number.isInteger(grandTourYear)) {
    sendJson(res, 400, { ok: false, error: "grandTourYear must be an integer." });
    return;
  }

  const runDryRun = deps.runDryRunReconcile ?? runDryRunReconcile;

  let report;
  try {
    // Always fetches fresh - never trusts a client-supplied report for
    // something this sensitive. reconcile: true always; there is no apply
    // option on this function to set.
    report = await runDryRun({
      provider,
      grandTourName,
      grandTourYear,
      fromStage: stageNumber,
      toStage: stageNumber,
      reconcile: true
    });
  } catch (error) {
    sendJson(res, 502, { ok: false, error: error instanceof Error ? error.message : "Fetching the official result failed." });
    return;
  }

  const { errors, stage } = validateReportForApply({
    report,
    confirmProvider: provider,
    confirmStage: stageNumber
  });
  if (errors.length > 0) {
    sendJson(res, 422, { ok: false, error: "The freshly-fetched report is not safe to apply.", errors, report });
    return;
  }

  const { rows, error: selectionError } = selectTopNRows(stage.parsedRiders);
  if (selectionError) {
    sendJson(res, 422, { ok: false, error: selectionError, report });
    return;
  }

  const { resultLines, error: mappingError } = mapRowsToResultLines(rows, stage.matchedRiders);
  if (mappingError) {
    sendJson(res, 422, { ok: false, error: mappingError, report });
    return;
  }

  const { jerseyHolderParams, error: jerseyError } = selectJerseyHolderParams(stage);
  if (jerseyError) {
    sendJson(res, 422, { ok: false, error: jerseyError, report });
    return;
  }

  const rpcParams = buildApplyRpcParams({
    report,
    stage,
    resultLines,
    jerseyHolderParams,
    reason: reason ?? `applied via admin UI (Run Official Check -> Apply Official Result) by ${userData.user.email ?? userData.user.id}`,
    requestId: `apply-ui-${stageNumber}-${Date.now()}`
  });

  const { data, error } = await authedClient.rpc("apply_grandtour_official_stage_result", rpcParams);
  const outcome = interpretRpcResponse({ data, error });

  sendJson(res, outcome.exitCode === 0 ? 200 : 502, {
    ok: outcome.exitCode === 0,
    status: outcome.status,
    message: outcome.message,
    data: data ?? null
  });
}

export default function handler(req, res) {
  return handleApplyOfficialResult(req, res);
}
