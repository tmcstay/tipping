/**
 * Pure retry/classification policy for provider (Resend) send attempts.
 * No Deno/network APIs.
 *
 * Retry schedule (task spec): attempt 1 immediate, attempt 2 after 15
 * minutes, attempt 3 after 60 minutes, then failed/manual review. Only
 * ever applies to *retryable* failures - a permanent rejection (invalid
 * recipient, suppressed recipient, explicit opt-out, permanent provider
 * rejection) goes straight to 'failed' on the first attempt, regardless of
 * attempt_count.
 */

export type ProviderFailureClass = "retryable" | "permanent";

/**
 * Classifies a Resend HTTP response status (no status = network/fetch
 * failure, always retryable). 400/401/403/422 are request-shape/permission/
 * validation problems (including invalid or suppressed recipients) that
 * will never succeed by simply trying again. 404 is treated as permanent
 * (nothing at that endpoint to retry against). 429 and 5xx are transient
 * provider/rate-limit conditions - retryable.
 */
export function classifyProviderFailure(status: number | null): ProviderFailureClass {
  if (status === null) return "retryable";
  if (status === 429) return "retryable";
  if (status >= 500) return "retryable";
  if (status >= 400) return "permanent";
  return "permanent";
}

const RETRY_DELAYS_MINUTES = [15, 60];
export const MAX_SEND_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;

export type RetryDecision =
  | { action: "retry"; nextAttemptAt: Date }
  | { action: "give_up" };

/**
 * `attemptCountAfterFailure` is the job's attempt_count AFTER incrementing
 * for the attempt that just failed (i.e. 1 after the first failed
 * attempt). A permanent failure always gives up immediately, regardless of
 * attempt count. A retryable failure gives up once the attempt budget
 * (MAX_SEND_ATTEMPTS) is exhausted.
 */
export function decideRetry(
  failureClass: ProviderFailureClass,
  attemptCountAfterFailure: number,
  now: Date
): RetryDecision {
  if (failureClass === "permanent") return { action: "give_up" };
  if (attemptCountAfterFailure >= MAX_SEND_ATTEMPTS) return { action: "give_up" };
  const delayMinutes = RETRY_DELAYS_MINUTES[attemptCountAfterFailure - 1];
  return { action: "retry", nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000) };
}

/**
 * A job stuck in 'processing' beyond this timeout (a crashed/killed
 * invocation never reached a terminal state) is safe to reclaim - it did
 * not necessarily fail, so it goes back to 'pending' rather than 'failed',
 * and next_attempt_at is reset to now so it's picked up on the very next
 * claim query. Does not touch attempt_count, since we don't know whether
 * the stuck attempt actually sent the email or not (only the DB failing to
 * observe its own claim is stuck - a genuinely double-sent email is
 * prevented separately by the Resend Idempotency-Key header + the
 * (user_id, stage_id, notification_type) unique constraint, not by this
 * timeout).
 */
export const STUCK_PROCESSING_TIMEOUT_MINUTES = 10;

export function isStuckProcessing(processingStartedAt: Date | null, now: Date): boolean {
  if (!processingStartedAt) return false;
  const elapsedMinutes = (now.getTime() - processingStartedAt.getTime()) / 60_000;
  return elapsedMinutes >= STUCK_PROCESSING_TIMEOUT_MINUTES;
}
