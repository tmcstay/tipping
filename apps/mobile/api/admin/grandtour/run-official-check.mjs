/**
 * POST /api/admin/grandtour/run-official-check
 *
 * Server-side (Vercel Node serverless function) endpoint backing the admin
 * UI's per-stage "Run Official Check" button
 * (components/GrandTourStageAdminCard.tsx). Runs the same dry-run +
 * reconcile check as scripts/grandtour-feed-import.mjs --dry-run --reconcile,
 * via the shared runDryRunReconcile() function, and returns the report to
 * the browser. This route:
 *
 *   - NEVER applies, finalises, or scores anything. runDryRunReconcile has
 *     no apply capability at all (see its doc comment in
 *     scripts/grandtour-feed-import.mjs) - --apply is not a concept that
 *     exists on this code path.
 *   - NEVER uses SUPABASE_SERVICE_ROLE_KEY. It only ever uses
 *     SUPABASE_URL plus SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY (the
 *     same public, RLS-scoped credentials already embedded in the browser
 *     bundle as EXPO_PUBLIC_SUPABASE_URL/EXPO_PUBLIC_SUPABASE_ANON_KEY -
 *     see docs/deployment.md). The scraper itself (letour.fr fetch +
 *     Supabase reconciliation reads) runs only here, server-side - never
 *     in browser code.
 *   - Requires a real signed-in session (Authorization: Bearer <access
 *     token>) AND cycling-admin membership, verified via the
 *     public.is_current_user_cycling_admin() RPC (a thin wrapper around
 *     the already-fixed grandtour_private.is_cycling_admin() check - see
 *     supabase/migrations/20260713010000_grandtour_is_current_user_cycling_admin_rpc.sql).
 *     Anonymous callers get 401; authenticated non-admins get 403.
 *   - Only accepts provider "official-letour" for now.
 */

import { runDryRunReconcile as realRunDryRunReconcile } from "../../../../../scripts/grandtour-feed-import.mjs";

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
 * The actual handler logic, exported separately from the default export so
 * tests can call it directly with a fake req/res and injected deps
 * (`deps.createClient`, `deps.runDryRunReconcile`) - no real network,
 * Supabase, or letour.fr call happens in tests.
 */
export async function handleRunOfficialCheck(req, res, deps = {}) {
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
  // Scoped to the caller's own session (their JWT is sent as the
  // Authorization header on every PostgREST/RPC call this client makes),
  // so auth.uid() inside is_current_user_cycling_admin() resolves to this
  // caller. This is the anon/publishable key, never a service-role key.
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

  const runDryRunReconcile = deps.runDryRunReconcile ?? realRunDryRunReconcile;

  try {
    // reconcile: true always - this is the only mode this route ever runs.
    // There is no `apply` field anywhere in this options object because
    // runDryRunReconcile has no apply code path to enable in the first place.
    const report = await runDryRunReconcile({
      provider,
      grandTourName,
      grandTourYear,
      fromStage: stageNumber,
      toStage: stageNumber,
      reconcile: true
    });
    sendJson(res, 200, { ok: true, report });
  } catch (error) {
    sendJson(res, 502, { ok: false, error: error instanceof Error ? error.message : "Official check failed." });
  }
}

export default function handler(req, res) {
  return handleRunOfficialCheck(req, res);
}
