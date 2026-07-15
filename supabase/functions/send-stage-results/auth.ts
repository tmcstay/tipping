/**
 * Internal scheduler authentication for send-stage-results. This function
 * is never invoked with a normal user JWT as authorisation - only a
 * shared secret (DAILY_RESULTS_JOB_SECRET) known to the pg_cron job (via
 * Supabase Vault - see 20260715060000_grandtour_stage_notification_cron.sql)
 * and to this function's own environment. verify_jwt is disabled for this
 * one function in supabase/config.toml specifically because this check
 * replaces it - see that file's comment.
 */

/** Constant-time string comparison so a timing side-channel can't help guess the secret byte-by-byte. */
export function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  // Deliberately still compares up to the longer length so the number of
  // bytes examined doesn't itself leak the correct secret's length.
  const length = Math.max(aBytes.length, bBytes.length);
  let mismatch = aBytes.length === bBytes.length ? 0 : 1;
  for (let i = 0; i < length; i += 1) {
    const byteA = aBytes[i] ?? 0;
    const byteB = bBytes[i] ?? 0;
    mismatch |= byteA ^ byteB;
  }
  return mismatch === 0;
}

export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match ? match[1] : null;
}

export function isAuthorizedSchedulerRequest(authorizationHeader: string | null, expectedSecret: string | null): boolean {
  if (!expectedSecret) return false;
  const token = extractBearerToken(authorizationHeader);
  if (!token) return false;
  return constantTimeEqual(token, expectedSecret);
}
