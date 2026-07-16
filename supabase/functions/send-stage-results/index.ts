// Private, internal-only processing function - never a browser-callable
// arbitrary-recipient endpoint. Authenticates via a shared scheduler
// secret (DAILY_RESULTS_JOB_SECRET), never a normal user JWT (see auth.ts
// and this function's `verify_jwt = false` entry in supabase/config.toml -
// disabled only because this internal check replaces it, per the task's
// own instruction not to use --no-verify-jwt without one).
//
// Workflow (see CLAUDE.md's "Resend transactional email" section):
//   finalised + scored stage -> generate missing jobs idempotently
//   -> claim a bounded batch of pending/retry-ready jobs -> render each
//   user's authoritative, already-scored result -> send via Resend
//   -> record the outcome. Never sends email inside a DB transaction/RPC -
//   all writes here are plain service-role table operations from this
//   Edge Function, and any external call (fetch to Resend) always happens
//   between two separate, already-committed writes (claim, then
//   sent/failed), never inside one.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";

import { formatGrandTourName } from "../_shared/email/grandTourDisplay.ts";
import {
  renderStageResultsEmail,
  type StageResultsEmailData,
  type StageResultsLeaderboardRow,
  type StageResultsTopFiveBadge,
} from "../_shared/email/render-stage-results.ts";
import { isAuthorizedSchedulerRequest } from "./auth.ts";
import { buildStageResultIdempotencyKey, classifyParticipant, isStageReadyForNotifications } from "./eligibility.ts";
import { classifyProviderFailure, decideRetry, isStuckProcessing } from "./retryPolicy.ts";

const RESEND_API_URL = "https://api.resend.com/emails";
const BATCH_SIZE = 25;
const SEND_CONCURRENCY = 5;

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type RequestBody = { stage_id?: string; mode?: string; dryRun?: boolean };

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  const schedulerSecret = Deno.env.get("DAILY_RESULTS_JOB_SECRET") ?? null;
  if (!isAuthorizedSchedulerRequest(req.headers.get("Authorization"), schedulerSecret)) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, error: "Server misconfiguration" }, 500);
  }

  let body: RequestBody;
  try {
    body = req.body ? ((await req.json()) as RequestBody) : {};
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }

  const dryRun = body.dryRun === true;
  const appPublicUrl = Deno.env.get("APP_PUBLIC_URL") ?? "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? null;
  const resultsEmailFrom = Deno.env.get("RESULTS_EMAIL_FROM") ?? null;
  const resultsEmailReplyTo = Deno.env.get("RESULTS_EMAIL_REPLY_TO") ?? null;

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // 1. Find the specific stage or every ready stage - "ready" is always
  // isStageReadyForNotifications(), never a date/presence guess.
  const stageIds = await resolveTargetStageIds(supabase, body);
  if (stageIds.length === 0) {
    return jsonResponse({ success: true, stages_checked: 0, jobs_created: 0, sent: 0, failed: 0, skipped: 0 }, 200);
  }

  // Recover jobs stuck in 'processing' beyond a safe timeout before
  // claiming anything new, so a crashed prior invocation can't
  // permanently strand its jobs.
  if (!dryRun) {
    await recoverStuckProcessingJobs(supabase);
  }

  let jobsCreated = 0;
  let skipped = 0;
  for (const stageId of stageIds) {
    const generated = await generateMissingJobsForStage(supabase, stageId);
    jobsCreated += generated.created;
    skipped += generated.skipped;
  }

  if (dryRun) {
    const preview = await buildDryRunPreview(supabase, stageIds, { appPublicUrl, resultsEmailReplyTo });
    return jsonResponse(
      { success: true, dryRun: true, stages_checked: stageIds.length, jobs_created: jobsCreated, skipped, would_send: preview.wouldSend, sample_subjects: preview.sampleSubjects },
      200
    );
  }

  if (!resendApiKey || !resultsEmailFrom) {
    return jsonResponse({ success: false, error: "Email service is not configured" }, 500);
  }

  const claimed = await claimBatch(supabase, BATCH_SIZE);
  let sent = 0;
  let failed = 0;
  let retrying = 0;

  for (let i = 0; i < claimed.length; i += SEND_CONCURRENCY) {
    const chunk = claimed.slice(i, i + SEND_CONCURRENCY);
    const results = await Promise.all(
      chunk.map((job) =>
        processJob(supabase, job, { appPublicUrl, resendApiKey, resultsEmailFrom, resultsEmailReplyTo })
      )
    );
    for (const outcome of results) {
      if (outcome === "sent") sent += 1;
      else if (outcome === "failed") failed += 1;
      else retrying += 1;
    }
  }

  return jsonResponse(
    { success: true, stages_checked: stageIds.length, jobs_created: jobsCreated, sent, failed, skipped, retrying },
    200
  );
});

// ---------------------------------------------------------------------------
// Stage resolution
// ---------------------------------------------------------------------------

async function resolveTargetStageIds(
  supabase: ReturnType<typeof createClient>,
  body: RequestBody
): Promise<string[]> {
  if (body.stage_id) {
    const ready = await isStageIdReady(supabase, body.stage_id);
    return ready ? [body.stage_id] : [];
  }

  // mode: "process_ready_stages" (or no mode at all - the scheduled/cron
  // path always sends this shape).
  const { data: results, error } = await supabase
    .from("grandtour_stage_results")
    .select("stage_id, is_final, review_status")
    .eq("is_final", true)
    .eq("review_status", "finalised");
  if (error) throw error;

  const ready: string[] = [];
  for (const result of results ?? []) {
    const scoreCount = await countStageScores(supabase, result.stage_id as string);
    if (isStageReadyForNotifications({ isFinal: true, reviewStatus: "finalised", scoreCount })) {
      ready.push(result.stage_id as string);
    }
  }
  return ready;
}

async function isStageIdReady(supabase: ReturnType<typeof createClient>, stageId: string): Promise<boolean> {
  const { data: result, error } = await supabase
    .from("grandtour_stage_results")
    .select("is_final, review_status")
    .eq("stage_id", stageId)
    .maybeSingle();
  if (error) throw error;
  if (!result) return false;
  const scoreCount = await countStageScores(supabase, stageId);
  return isStageReadyForNotifications({
    isFinal: result.is_final as boolean,
    reviewStatus: result.review_status as string | null,
    scoreCount,
  });
}

async function countStageScores(supabase: ReturnType<typeof createClient>, stageId: string): Promise<number> {
  const { count, error } = await supabase
    .from("grandtour_stage_scores")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", stageId);
  if (error) throw error;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Job generation (idempotent)
// ---------------------------------------------------------------------------

async function generateMissingJobsForStage(
  supabase: ReturnType<typeof createClient>,
  stageId: string
): Promise<{ created: number; skipped: number }> {
  const { data: scoreRows, error } = await supabase
    .from("grandtour_stage_scores")
    .select("user_id, grandtour_tips!inner(status)")
    .eq("stage_id", stageId)
    .in("grandtour_tips.status", ["scored", "corrected"]);
  if (error) throw error;

  const userIds = Array.from(new Set((scoreRows ?? []).map((row) => row.user_id as string)));
  if (userIds.length === 0) return { created: 0, skipped: 0 };

  const [profilesResult, preferencesResult] = await Promise.all([
    supabase.from("profiles").select("id, email").in("id", userIds),
    supabase.from("grandtour_notification_preferences").select("user_id, results_email_enabled").in("user_id", userIds),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (preferencesResult.error) throw preferencesResult.error;

  const emailByUser = new Map((profilesResult.data ?? []).map((row) => [row.id as string, row.email as string | null]));
  const preferenceByUser = new Map(
    (preferencesResult.data ?? []).map((row) => [row.user_id as string, row.results_email_enabled as boolean])
  );

  const rowsToInsert = userIds.map((userId) => {
    const plan = classifyParticipant({
      resultsEmailEnabled: preferenceByUser.get(userId) ?? true,
      email: emailByUser.get(userId) ?? null,
    });
    return {
      user_id: userId,
      stage_id: stageId,
      notification_type: "stage_results" as const,
      channel: "email" as const,
      status: plan.status,
      last_error_code: plan.status === "skipped" ? plan.reason : null,
      idempotency_key: buildStageResultIdempotencyKey(stageId, userId),
    };
  });

  const { data: inserted, error: insertError } = await supabase
    .from("grandtour_stage_notification_jobs")
    .upsert(rowsToInsert, { onConflict: "user_id,stage_id,notification_type", ignoreDuplicates: true })
    .select("id, status");
  if (insertError) throw insertError;
  const insertedRows = (inserted ?? []) as { id: string; status: string }[];
  return {
    created: insertedRows.length,
    skipped: insertedRows.filter((row) => row.status === "skipped").length,
  };
}

// ---------------------------------------------------------------------------
// Stuck-processing recovery + claiming
// ---------------------------------------------------------------------------

async function recoverStuckProcessingJobs(supabase: ReturnType<typeof createClient>): Promise<void> {
  const { data: processingJobs, error } = await supabase
    .from("grandtour_stage_notification_jobs")
    .select("id, processing_started_at")
    .eq("status", "processing");
  if (error) throw error;

  const now = new Date();
  const stuckIds = (processingJobs ?? [])
    .filter((job) => isStuckProcessing(job.processing_started_at ? new Date(job.processing_started_at as string) : null, now))
    .map((job) => job.id as string);
  if (stuckIds.length === 0) return;

  const { error: resetError } = await supabase
    .from("grandtour_stage_notification_jobs")
    .update({ status: "pending", next_attempt_at: now.toISOString(), processing_started_at: null })
    .in("id", stuckIds);
  if (resetError) throw resetError;
}

type ClaimedJob = {
  id: string;
  user_id: string;
  stage_id: string;
  attempt_count: number;
  idempotency_key: string;
};

async function claimBatch(supabase: ReturnType<typeof createClient>, batchSize: number): Promise<ClaimedJob[]> {
  const now = new Date().toISOString();
  const { data: candidates, error } = await supabase
    .from("grandtour_stage_notification_jobs")
    .select("id")
    .eq("status", "pending")
    .lte("next_attempt_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(batchSize);
  if (error) throw error;
  const ids = (candidates ?? []).map((row) => row.id as string);
  if (ids.length === 0) return [];

  // Two-step claim (select candidate ids, then a scoped conditional
  // update) rather than a single UPDATE ... LIMIT, since PostgREST has no
  // LIMIT-on-UPDATE primitive - the `status = 'pending'` re-check in the
  // update's own filter still prevents a double-claim race between
  // overlapping invocations for the same row.
  const { data: claimed, error: claimError } = await supabase
    .from("grandtour_stage_notification_jobs")
    .update({ status: "processing", processing_started_at: now })
    .in("id", ids)
    .eq("status", "pending")
    .select("id, user_id, stage_id, attempt_count, idempotency_key");
  if (claimError) throw claimError;
  return (claimed ?? []) as ClaimedJob[];
}

// ---------------------------------------------------------------------------
// Rendering + sending
// ---------------------------------------------------------------------------

type SendEnv = {
  appPublicUrl: string;
  resendApiKey: string;
  resultsEmailFrom: string;
  resultsEmailReplyTo: string | null;
};

async function processJob(
  supabase: ReturnType<typeof createClient>,
  job: ClaimedJob,
  env: SendEnv
): Promise<"sent" | "failed" | "retry-scheduled"> {
  const attemptCount = (job.attempt_count ?? 0) + 1;
  const now = new Date();

  let emailData: StageResultsEmailData;
  let recipientEmail: string;
  try {
    const built = await buildEmailData(supabase, job, env.appPublicUrl);
    emailData = built.data;
    recipientEmail = built.email;
  } catch {
    // A render-data failure (missing rider/profile row, etc.) is treated as
    // permanent - retrying without a code change won't fix missing data.
    await supabase
      .from("grandtour_stage_notification_jobs")
      .update({ status: "failed", attempt_count: attemptCount, last_error_code: "render_error" })
      .eq("id", job.id);
    return "failed";
  }

  const rendered = renderStageResultsEmail(emailData);
  const resendPayload: Record<string, unknown> = {
    from: env.resultsEmailFrom,
    to: [recipientEmail],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  };
  if (env.resultsEmailReplyTo) resendPayload.reply_to = env.resultsEmailReplyTo;

  let response: Response;
  try {
    response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": job.idempotency_key,
      },
      body: JSON.stringify(resendPayload),
    });
  } catch {
    const decision = decideRetry(classifyProviderFailure(null), attemptCount, now);
    await applyRetryDecision(supabase, job.id, decision, attemptCount, "network_error");
    return decision.action === "retry" ? "retry-scheduled" : "failed";
  }

  if (response.ok) {
    let responseBody: { id?: string } | null = null;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }
    await supabase
      .from("grandtour_stage_notification_jobs")
      .update({ status: "sent", sent_at: now.toISOString(), provider_message_id: responseBody?.id ?? null, attempt_count: attemptCount })
      .eq("id", job.id);
    return "sent";
  }

  const failureClass = classifyProviderFailure(response.status);
  const decision = decideRetry(failureClass, attemptCount, now);
  const providerMessage = await readProviderErrorMessage(response);
  const errorCode = providerMessage ? `provider_${response.status}:${providerMessage}` : `provider_${response.status}`;
  await applyRetryDecision(supabase, job.id, decision, attemptCount, errorCode);
  return decision.action === "retry" ? "retry-scheduled" : "failed";
}

// Captures Resend's own error message (e.g. "Invalid `reply_to` field") so a
// permanent failure is actually diagnosable from last_error_code alone,
// instead of just an opaque HTTP status - truncated defensively since this
// is untrusted upstream text going into a text column, never surfaced back
// to the caller of this function (only visible via direct DB/admin access).
async function readProviderErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { message?: string; name?: string } | null;
    const message = body?.message ?? body?.name ?? null;
    return message ? message.slice(0, 300) : null;
  } catch {
    return null;
  }
}

async function applyRetryDecision(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  decision: ReturnType<typeof decideRetry>,
  attemptCount: number,
  errorCode: string
): Promise<void> {
  if (decision.action === "retry") {
    await supabase
      .from("grandtour_stage_notification_jobs")
      .update({ status: "pending", next_attempt_at: decision.nextAttemptAt.toISOString(), attempt_count: attemptCount, last_error_code: errorCode })
      .eq("id", jobId);
  } else {
    await supabase
      .from("grandtour_stage_notification_jobs")
      .update({ status: "failed", attempt_count: attemptCount, last_error_code: errorCode })
      .eq("id", jobId);
  }
}

// ---------------------------------------------------------------------------
// Building the authoritative per-user email data
// ---------------------------------------------------------------------------

async function buildEmailData(
  supabase: ReturnType<typeof createClient>,
  job: { user_id: string; stage_id: string },
  appPublicUrl: string
): Promise<{ data: StageResultsEmailData; email: string }> {
  const { data: stage, error: stageError } = await supabase
    .from("grandtour_stages")
    .select("id, stage_number, stage_name, starts_at, grand_tour_id")
    .eq("id", job.stage_id)
    .single();
  if (stageError) throw stageError;

  const { data: grandTour, error: grandTourError } = await supabase
    .from("grand_tours")
    .select("id, name, year")
    .eq("id", stage.grand_tour_id as string)
    .single();
  if (grandTourError) throw grandTourError;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("email, display_name, first_name")
    .eq("id", job.user_id)
    .single();
  if (profileError) throw profileError;
  const email = profile.email as string | null;
  if (!email) throw new Error("Recipient has no usable email address.");

  const { data: score, error: scoreError } = await supabase
    .from("grandtour_stage_scores")
    .select("competition_id, total_score, score_details, tip_id")
    .eq("stage_id", job.stage_id)
    .eq("user_id", job.user_id)
    .single();
  if (scoreError) throw scoreError;

  const { data: tip, error: tipError } = await supabase
    .from("grandtour_tips")
    .select("id, grandtour_tip_selections(selection_type, rider_id, predicted_position)")
    .eq("id", score.tip_id as string)
    .single();
  if (tipError) throw tipError;

  const { data: resultLines, error: linesError } = await supabase
    .from("grandtour_stage_result_lines")
    .select("actual_position, rider_id, grandtour_riders(display_name)")
    .eq("stage_result_id", (await getStageResultId(supabase, job.stage_id)) ?? "")
    .order("actual_position", { ascending: true });
  if (linesError) throw linesError;

  const riderIds = new Set<string>();
  for (const selection of (tip.grandtour_tip_selections ?? []) as { rider_id: string | null }[]) {
    if (selection.rider_id) riderIds.add(selection.rider_id);
  }
  for (const line of resultLines ?? []) {
    if (line.rider_id) riderIds.add(line.rider_id as string);
  }
  const { data: riders, error: ridersError } = riderIds.size
    ? await supabase.from("grandtour_riders").select("id, display_name").in("id", Array.from(riderIds))
    : { data: [], error: null };
  if (ridersError) throw ridersError;
  const riderNameById = new Map((riders ?? []).map((rider) => [rider.id as string, rider.display_name as string]));

  const scoreDetails = (score.score_details ?? {}) as {
    top_five?: { predicted_position: number; actual_position: number | null; points: number | null }[];
  };
  const topFiveByPosition = new Map((scoreDetails.top_five ?? []).map((row) => [row.predicted_position, row]));
  const selectionsByPosition = new Map(
    ((tip.grandtour_tip_selections ?? []) as { selection_type: string; rider_id: string | null; predicted_position: number | null }[])
      .filter((selection) => selection.selection_type === "stage_top_5")
      .map((selection) => [selection.predicted_position as number, selection.rider_id])
  );
  const resultByPosition = new Map((resultLines ?? []).map((line) => [line.actual_position as number, line.rider_id as string]));

  const topFive = ([1, 2, 3, 4, 5] as const).map((position) => {
    const riderId = selectionsByPosition.get(position) ?? null;
    const scoreRow = topFiveByPosition.get(position) ?? null;
    const actualPosition = scoreRow?.actual_position ?? null;
    const points = scoreRow?.points ?? null;
    let badge: StageResultsTopFiveBadge = "not-picked";
    if (riderId) {
      if (actualPosition === position) badge = "exact";
      else if (actualPosition !== null && actualPosition <= 5) badge = "partial";
      else badge = "miss";
    }
    return {
      predictedPosition: position,
      riderName: riderId ? riderNameById.get(riderId) ?? "Unknown rider" : null,
      actualPositionLabel: actualPosition !== null ? ordinal(actualPosition) : riderId ? "Outside top 5" : "—",
      points,
      badge,
    };
  });

  const actualTopFive = Array.from(resultByPosition.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([position, riderId]) => ({ position, riderName: riderNameById.get(riderId) ?? "Unknown rider" }));

  const { data: leaderboard, error: leaderboardError } = await supabase.rpc("get_grandtour_leaderboard_with_movement", {
    p_competition_id: score.competition_id,
    p_leaderboard_type: "overall",
  });
  if (leaderboardError) throw leaderboardError;
  const leaderboardRows = (leaderboard ?? []) as {
    user_id: string;
    rank: number;
    previous_rank: number | null;
    total_score: number;
    display_name: string | null;
  }[];
  const selfRow = leaderboardRows.find((row) => row.user_id === job.user_id) ?? null;
  const currentRank = selfRow?.rank ?? 0;
  const previousRank = selfRow?.previous_rank ?? null;
  const totalScore = selfRow?.total_score ?? (score.total_score as number);

  const leaderboardSnapshot = buildLeaderboardSnapshot(leaderboardRows, job.user_id);
  const nextStage = await findNextStage(supabase, stage.grand_tour_id as string, stage.stage_number as number);

  const displayName = (profile.display_name as string | null) ?? (profile.first_name as string | null) ?? email.split("@")[0];

  return {
    email,
    data: {
      eventName: formatGrandTourName({ name: grandTour.name as string, year: grandTour.year as number }),
      stageNumber: stage.stage_number as number,
      stageName: (stage.stage_name as string | null) ?? null,
      stageDateLabel: stage.starts_at ? formatStageDate(stage.starts_at as string) : null,
      displayName,
      stageScore: score.total_score as number,
      totalScore,
      currentRank,
      previousRank,
      participantCount: leaderboardRows.length || null,
      topFive,
      actualTopFive,
      leaderboard: leaderboardSnapshot,
      scoreGapToNext: computeScoreGapToNext(leaderboardRows, currentRank),
      nextStage,
      appPublicUrl,
      supportEmail: null,
    },
  };
}

async function getStageResultId(supabase: ReturnType<typeof createClient>, stageId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("grandtour_stage_results")
    .select("id")
    .eq("stage_id", stageId)
    .maybeSingle();
  if (error) throw error;
  return (data?.id as string | undefined) ?? null;
}

function buildLeaderboardSnapshot(
  rows: { user_id: string; rank: number; total_score: number; display_name: string | null }[],
  currentUserId: string
): StageResultsLeaderboardRow[] | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  const selfIndex = sorted.findIndex((row) => row.user_id === currentUserId);
  if (selfIndex === -1) return null;
  const start = Math.max(0, selfIndex - 2);
  const end = Math.min(sorted.length, selfIndex + 3);
  return sorted.slice(start, end).map((row) => ({
    rank: row.rank,
    displayName: row.display_name ?? "Player",
    totalScore: row.total_score,
    isCurrentUser: row.user_id === currentUserId,
  }));
}

function computeScoreGapToNext(rows: { rank: number; total_score: number }[], currentRank: number): number | null {
  if (currentRank <= 1) return null;
  const next = rows.find((row) => row.rank === currentRank - 1);
  const self = rows.find((row) => row.rank === currentRank);
  if (!next || !self) return null;
  const gap = next.total_score - self.total_score;
  return gap > 0 ? gap : null;
}

async function findNextStage(
  supabase: ReturnType<typeof createClient>,
  grandTourId: string,
  currentStageNumber: number
): Promise<StageResultsEmailData["nextStage"]> {
  const { data: nextStage, error } = await supabase
    .from("grandtour_stages")
    .select("id, stage_number, locks_at, starts_at")
    .eq("grand_tour_id", grandTourId)
    .eq("stage_number", currentStageNumber + 1)
    .maybeSingle();
  if (error) throw error;
  if (!nextStage) return null;
  const lockTime = (nextStage.locks_at as string | null) ?? (nextStage.starts_at as string | null);
  const isOpen = lockTime ? new Date(lockTime).getTime() > Date.now() : true;
  return { isOpen, stageId: nextStage.id as string, stageNumber: nextStage.stage_number as number };
}

function ordinal(value: number): string {
  const suffix = value === 1 ? "st" : value === 2 ? "nd" : value === 3 ? "rd" : "th";
  return `${value}${suffix}`;
}

function formatStageDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

async function buildDryRunPreview(
  supabase: ReturnType<typeof createClient>,
  stageIds: string[],
  env: { appPublicUrl: string; resultsEmailReplyTo: string | null }
): Promise<{ wouldSend: number; sampleSubjects: string[] }> {
  const { data: pendingJobs, error } = await supabase
    .from("grandtour_stage_notification_jobs")
    .select("id, user_id, stage_id")
    .eq("status", "pending")
    .in("stage_id", stageIds)
    .limit(5);
  if (error) throw error;

  const sampleSubjects: string[] = [];
  for (const job of (pendingJobs ?? []) as { user_id: string; stage_id: string }[]) {
    try {
      const built = await buildEmailData(supabase, job, env.appPublicUrl);
      sampleSubjects.push(renderStageResultsEmail(built.data).subject);
    } catch (error) {
      // Skip unrenderable sample rows in the dry-run preview only - this
      // never affects real job status, since dry run never mutates jobs.
      // Logged (job id only, never PII/secrets) so a genuine data problem
      // is still visible in function logs instead of silently vanishing.
      console.error(`send-stage-results dry-run: failed to render sample for job ${job.stage_id}/${job.user_id}:`, error);
    }
  }

  const { count, error: countError } = await supabase
    .from("grandtour_stage_notification_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .in("stage_id", stageIds);
  if (countError) throw countError;

  return { wouldSend: count ?? 0, sampleSubjects };
}
