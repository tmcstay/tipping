#!/usr/bin/env node
// Repoints the production Vault secrets that
// 20260715060000_grandtour_stage_notification_cron.sql seeds with
// LOCAL-safe placeholders at the real deployed send-stage-results URL and
// a real scheduler secret. Never run against production without both
// values genuinely ready; never commit the real values anywhere - this
// script only ever reads them from your own shell environment.
//
// Usage (production, after `supabase functions deploy send-stage-results`):
//   SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" \
//   GRANDTOUR_NOTIFICATION_FUNCTION_URL="https://<project-ref>.supabase.co/functions/v1/send-stage-results" \
//   GRANDTOUR_NOTIFICATION_SCHEDULER_SECRET="<a real, long, random secret>" \
//   DAILY_RESULTS_JOB_SECRET="<the exact same value>" \
//   node scripts/grandtour-configure-notification-cron-production.mjs
//
// The DAILY_RESULTS_JOB_SECRET value above must also be set as a hosted
// Edge Function secret (`npx supabase secrets set DAILY_RESULTS_JOB_SECRET=...`)
// separately - this script only updates the Vault-side copy the cron job
// reads, not the Edge Function's own environment.
import pg from "pg";

const { SUPABASE_DB_URL, GRANDTOUR_NOTIFICATION_FUNCTION_URL, GRANDTOUR_NOTIFICATION_SCHEDULER_SECRET } = process.env;

function requireEnv(name, value) {
  if (!value || !value.trim()) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

requireEnv("SUPABASE_DB_URL", SUPABASE_DB_URL);
requireEnv("GRANDTOUR_NOTIFICATION_FUNCTION_URL", GRANDTOUR_NOTIFICATION_FUNCTION_URL);
requireEnv("GRANDTOUR_NOTIFICATION_SCHEDULER_SECRET", GRANDTOUR_NOTIFICATION_SCHEDULER_SECRET);

if (SUPABASE_DB_URL.includes("127.0.0.1") || SUPABASE_DB_URL.includes("localhost")) {
  console.error("Refusing to run: SUPABASE_DB_URL looks like a local database, not production.");
  process.exit(1);
}

if (!GRANDTOUR_NOTIFICATION_FUNCTION_URL.startsWith("https://")) {
  console.error("Refusing to run: GRANDTOUR_NOTIFICATION_FUNCTION_URL must be a real https:// URL.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: SUPABASE_DB_URL });

async function updateVaultSecretByName(pgClient, name, newSecretValue) {
  const { rows } = await pgClient.query("select id from vault.secrets where name = $1", [name]);
  if (rows.length === 0) {
    throw new Error(`Vault secret '${name}' not found - has the 20260715060000 migration been pushed to this project?`);
  }
  await pgClient.query("select vault.update_secret($1, $2)", [rows[0].id, newSecretValue]);
}

async function main() {
  await client.connect();
  try {
    // vault.decrypted_secrets is a read-only decrypted view - updates go
    // through vault.update_secret(secret_id, new_secret), keyed by the
    // secret's id (looked up by name from the raw vault.secrets table).
    await updateVaultSecretByName(client, "grandtour_notification_function_url", GRANDTOUR_NOTIFICATION_FUNCTION_URL);
    await updateVaultSecretByName(client, "grandtour_notification_scheduler_secret", GRANDTOUR_NOTIFICATION_SCHEDULER_SECRET);
    // Never logs the secret values themselves.
    console.log("Updated grandtour_notification_function_url and grandtour_notification_scheduler_secret in Vault.");
    console.log("Reminder: DAILY_RESULTS_JOB_SECRET must also be set as a hosted Edge Function secret with the same value as GRANDTOUR_NOTIFICATION_SCHEDULER_SECRET.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to update production notification cron secrets:", error.message);
  process.exit(1);
});
