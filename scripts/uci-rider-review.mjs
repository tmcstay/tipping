#!/usr/bin/env node
// Small CLI for the UCI rider registry review queue
// (public.uci_rider_review_queue). Lists pending items, or resolves one
// via public.resolve_uci_rider_review_item(...). Service-role key only
// (same safety-gate pattern as scripts/grandtour-admin-stage.mjs), never
// fetches uci.org or letour.fr itself.

import { pathToFileURL } from "node:url";

import { decodeJwtRole, isProductionSupabaseUrl } from "./grandtour-apply.mjs";
import { fetchPendingReviewItems } from "./uci-rider-sync-supabase.mjs";

export function parseReviewArgs(argv) {
  const options = {
    list: true,
    status: "pending",
    resolveId: null,
    resolveStatus: null,
    resolvedBy: null,
    note: null,
    createAliasText: null,
    aliasType: null,
    aliasRiderId: null,
    confirmProduction: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--list") options.list = true;
    else if (argument === "--status") {
      const value = argv[++index];
      if (!value) throw new Error("--status requires a value");
      options.status = value;
    } else if (argument === "--resolve") {
      const value = argv[++index];
      if (!value) throw new Error("--resolve requires a review-queue item id");
      options.resolveId = value;
      options.list = false;
    } else if (argument === "--resolve-status") {
      const value = argv[++index];
      if (!value) throw new Error("--resolve-status requires a value (matched/new_rider_approved/source_correction/ignored/resolved)");
      options.resolveStatus = value;
    } else if (argument === "--note") {
      const value = argv[++index];
      if (!value) throw new Error("--note requires a value");
      options.note = value;
    } else if (argument === "--create-alias") {
      const value = argv[++index];
      if (!value) throw new Error("--create-alias requires the alias text");
      options.createAliasText = value;
    } else if (argument === "--alias-type") {
      const value = argv[++index];
      if (!value) throw new Error("--alias-type requires a value");
      options.aliasType = value;
    } else if (argument === "--alias-rider-id") {
      const value = argv[++index];
      if (!value) throw new Error("--alias-rider-id requires a uci_riders id");
      options.aliasRiderId = value;
    } else if (argument === "--resolved-by") {
      const value = argv[++index];
      if (!value) throw new Error("--resolved-by requires a user id");
      options.resolvedBy = value;
    } else if (argument === "--confirm-production") {
      options.confirmProduction = true;
    } else {
      throw new Error(`Unknown argument: ${argument}. See the top of scripts/uci-rider-review.mjs for the supported flags.`);
    }
  }
  if (options.resolveId && !options.resolveStatus) {
    throw new Error("--resolve requires --resolve-status.");
  }
  return options;
}

async function buildServiceClient(options, deps) {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("This CLI requires SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  }
  const keyRole = decodeJwtRole(serviceRoleKey);
  if (keyRole !== "service_role") {
    throw new Error(`This CLI requires a genuine service-role key; SUPABASE_SERVICE_ROLE_KEY decodes to role ${JSON.stringify(keyRole)}.`);
  }
  if (isProductionSupabaseUrl(url) && !options.confirmProduction) {
    throw new Error(`SUPABASE_URL (${url}) resolves to a known production project. Re-run with --confirm-production to proceed.`);
  }
  const createClient = deps.createClient ?? (await import("@supabase/supabase-js")).createClient;
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function runList(options, deps = {}) {
  const client = await buildServiceClient(options, deps);
  return fetchPendingReviewItems(client, { status: options.status });
}

export async function runResolve(options, deps = {}) {
  const client = await buildServiceClient(options, deps);
  const params = {
    p_item_id: options.resolveId,
    p_status: options.resolveStatus,
    p_resolved_by: options.resolvedBy ?? null,
    p_note: options.note ?? null,
    p_create_alias: options.createAliasText
      ? { rider_id: options.aliasRiderId, alias_text: options.createAliasText, alias_type: options.aliasType }
      : null,
  };
  const { data, error } = await client.rpc("resolve_uci_rider_review_item", params);
  if (error) throw new Error(`resolve_uci_rider_review_item failed: ${error.message}`);
  return data;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseReviewArgs(argv);
  if (options.resolveId) {
    const result = await runResolve(options, deps);
    console.log(JSON.stringify({ mode: "resolve", ...result }, null, 2));
    return;
  }
  const items = await runList(options, deps);
  console.log(JSON.stringify({ mode: "list", status: options.status, count: items.length, items }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    console.error(`uci-rider-review failed: ${error.message}`);
    process.exitCode = 1;
  }
}
