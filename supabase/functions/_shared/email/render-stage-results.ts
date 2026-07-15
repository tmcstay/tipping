import { escapeHtml } from "./htmlEscape.ts";
import { computeRankMovement, formatMovementBadge, formatSubjectMovementClause } from "./movement.ts";

/**
 * Pure email-rendering module for the stage-results email. No Deno/network
 * APIs - takes already-loaded, already-authoritative data (never
 * recomputes scoring) and returns subject/preheader/html/text. Unit-tested
 * directly with `node --test` (see render-stage-results.test.ts).
 */

export type StageResultsTopFiveBadge = "exact" | "partial" | "miss" | "not-picked";

export type StageResultsTopFiveRow = {
  predictedPosition: 1 | 2 | 3 | 4 | 5;
  riderName: string | null;
  actualPositionLabel: string;
  points: number | null;
  badge: StageResultsTopFiveBadge;
};

export type StageResultsActualRow = {
  position: number;
  riderName: string;
};

export type StageResultsLeaderboardRow = {
  rank: number;
  displayName: string;
  totalScore: number;
  isCurrentUser: boolean;
};

export type StageResultsNextStage = {
  isOpen: boolean;
  stageId: string;
  stageNumber: number;
};

export type StageResultsEmailData = {
  eventName: string;
  stageNumber: number;
  stageName: string | null;
  stageDateLabel: string | null;
  displayName: string;
  stageScore: number;
  totalScore: number;
  currentRank: number;
  previousRank: number | null;
  participantCount: number | null;
  topFive: StageResultsTopFiveRow[];
  actualTopFive: StageResultsActualRow[];
  leaderboard: StageResultsLeaderboardRow[] | null;
  scoreGapToNext: number | null;
  nextStage: StageResultsNextStage | null;
  appPublicUrl: string;
  supportEmail: string | null;
};

export type RenderedStageResultsEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};

export function buildSubject(data: Pick<StageResultsEmailData, "stageNumber" | "stageScore" | "currentRank" | "previousRank">): string {
  const movement = computeRankMovement(data.currentRank, data.previousRank);
  const clause = formatSubjectMovementClause(movement);
  const pointsLabel = `${data.stageScore} point${data.stageScore === 1 ? "" : "s"}`;
  const base = `Stage ${data.stageNumber} results: You scored ${pointsLabel}`;
  return clause ? `${base} ${clause}` : base;
}

export function buildPreheader(): string {
  return "See your tips, points, overall position and the next stage.";
}

function badgeTone(badge: StageResultsTopFiveBadge): { bg: string; fg: string; label: string } {
  switch (badge) {
    case "exact":
      return { bg: "#E3F5EC", fg: "#0E5C42", label: "Exact" };
    case "partial":
      return { bg: "#E5F1FB", fg: "#1079BF", label: "Top 5" };
    case "miss":
      return { bg: "#F1F1F1", fg: "#666666", label: "Miss" };
    case "not-picked":
    default:
      return { bg: "#F1F1F1", fg: "#999999", label: "—" };
  }
}

function buildPrimaryAction(data: StageResultsEmailData): { label: string; href: string } {
  if (data.nextStage && data.nextStage.isOpen) {
    return {
      label: `Tip Stage ${data.nextStage.stageNumber}`,
      href: `${data.appPublicUrl}/stages/${data.nextStage.stageId}`,
    };
  }
  return { label: "View Full Results", href: `${data.appPublicUrl}/results` };
}

export function renderStageResultsEmail(data: StageResultsEmailData): RenderedStageResultsEmail {
  const subject = buildSubject(data);
  const preheader = buildPreheader();
  const movement = computeRankMovement(data.currentRank, data.previousRank);
  const movementBadge = formatMovementBadge(movement);
  const primaryAction = buildPrimaryAction(data);
  const safeDisplayName = escapeHtml(data.displayName);
  const safeEventName = escapeHtml(data.eventName);
  const safeStageName = data.stageName ? escapeHtml(data.stageName) : null;
  const preferencesUrl = `${data.appPublicUrl}/profile`;

  const topFiveRowsHtml = data.topFive
    .map((row) => {
      const tone = badgeTone(row.badge);
      const riderName = row.riderName ? escapeHtml(row.riderName) : "Not picked";
      const pointsLabel = row.points !== null ? `+${row.points}` : "—";
      return `
        <tr>
          <td style="padding:8px 4px;font-size:13px;color:#666666;">${row.predictedPosition}</td>
          <td style="padding:8px 4px;font-size:14px;color:#1a1a1a;">${riderName}</td>
          <td style="padding:8px 4px;font-size:13px;color:#666666;">${escapeHtml(row.actualPositionLabel)}</td>
          <td style="padding:8px 4px;font-size:13px;font-weight:700;color:${tone.fg};">${pointsLabel}</td>
          <td style="padding:8px 4px;">
            <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:${tone.bg};color:${tone.fg};">${tone.label}</span>
          </td>
        </tr>`;
    })
    .join("");

  const actualTopFiveHtml = data.actualTopFive
    .map(
      (row) => `
        <tr>
          <td style="padding:6px 4px;font-size:13px;color:#666666;">${row.position}</td>
          <td style="padding:6px 4px;font-size:14px;color:#1a1a1a;">${escapeHtml(row.riderName)}</td>
        </tr>`
    )
    .join("");

  const leaderboardHtml = data.leaderboard
    ? `
      <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:8px;">
        ${data.leaderboard
          .map(
            (row) => `
          <tr style="${row.isCurrentUser ? "background:#EAF3FF;" : ""}">
            <td style="padding:6px 4px;font-size:13px;color:#666666;">${row.rank}</td>
            <td style="padding:6px 4px;font-size:14px;color:#1a1a1a;font-weight:${row.isCurrentUser ? "700" : "400"};">${escapeHtml(row.displayName)}${row.isCurrentUser ? " (you)" : ""}</td>
            <td style="padding:6px 4px;font-size:13px;color:#666666;text-align:right;">${row.totalScore} pts</td>
          </tr>`
          )
          .join("")}
      </table>
      ${data.scoreGapToNext !== null ? `<p style="font-size:12px;color:#666666;margin:8px 0 0 0;">${data.scoreGapToNext} point${data.scoreGapToNext === 1 ? "" : "s"} to the next position.</p>` : ""}
    `
    : "";

  const participantsLabel = data.participantCount !== null ? ` of ${data.participantCount}` : "";

  const html = `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${subject}</title>
<style>
  body { background:#F5F6F8; margin:0; padding:0; }
  @media (prefers-color-scheme: dark) {
    body, .email-bg { background:#121212 !important; }
    .email-card { background:#1E1E1E !important; border-color:#333333 !important; }
    .email-ink { color:#F0F0F0 !important; }
    .email-muted { color:#AAAAAA !important; }
  }
</style>
</head>
<body class="email-bg" style="background:#F5F6F8;margin:0;padding:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
  <div style="max-width:520px;margin:0 auto;padding:24px 16px;">
    <p class="email-muted" style="font-size:12px;color:#666666;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:0.04em;">${safeEventName}</p>
    <h1 class="email-ink" style="font-size:20px;color:#1a1a1a;margin:0 0 4px 0;">Stage ${data.stageNumber}${safeStageName ? `: ${safeStageName}` : ""}</h1>
    ${data.stageDateLabel ? `<p class="email-muted" style="font-size:13px;color:#666666;margin:0 0 20px 0;">${escapeHtml(data.stageDateLabel)}</p>` : `<div style="margin-bottom:20px;"></div>`}

    <p class="email-ink" style="font-size:15px;color:#1a1a1a;margin:0 0 16px 0;">Hi ${safeDisplayName}, here's how Stage ${data.stageNumber} went for you.</p>

    <table role="presentation" width="100%" class="email-card" style="border-collapse:collapse;background:#FFFFFF;border:1px solid #E5E5E5;border-radius:12px;margin-bottom:20px;">
      <tr>
        <td style="padding:16px;text-align:center;width:25%;">
          <p class="email-muted" style="font-size:11px;color:#666666;margin:0 0 4px 0;text-transform:uppercase;">Stage score</p>
          <p class="email-ink" style="font-size:20px;font-weight:700;color:#1a1a1a;margin:0;">${data.stageScore}</p>
        </td>
        <td style="padding:16px;text-align:center;width:25%;">
          <p class="email-muted" style="font-size:11px;color:#666666;margin:0 0 4px 0;text-transform:uppercase;">Total score</p>
          <p class="email-ink" style="font-size:20px;font-weight:700;color:#1a1a1a;margin:0;">${data.totalScore}</p>
        </td>
        <td style="padding:16px;text-align:center;width:25%;">
          <p class="email-muted" style="font-size:11px;color:#666666;margin:0 0 4px 0;text-transform:uppercase;">Rank</p>
          <p class="email-ink" style="font-size:20px;font-weight:700;color:#1a1a1a;margin:0;">${data.currentRank}${participantsLabel}</p>
        </td>
        <td style="padding:16px;text-align:center;width:25%;">
          <p class="email-muted" style="font-size:11px;color:#666666;margin:0 0 4px 0;text-transform:uppercase;">Movement</p>
          <p class="email-ink" style="font-size:20px;font-weight:700;color:#1a1a1a;margin:0;">${movementBadge}</p>
        </td>
      </tr>
    </table>

    <h2 class="email-ink" style="font-size:15px;color:#1a1a1a;margin:0 0 8px 0;">Your Top 5</h2>
    <table role="presentation" width="100%" style="border-collapse:collapse;margin-bottom:20px;">
      ${topFiveRowsHtml}
    </table>

    <h2 class="email-ink" style="font-size:15px;color:#1a1a1a;margin:0 0 8px 0;">Confirmed Stage Top 5</h2>
    <table role="presentation" width="100%" style="border-collapse:collapse;margin-bottom:20px;">
      ${actualTopFiveHtml}
    </table>

    ${data.leaderboard ? `<h2 class="email-ink" style="font-size:15px;color:#1a1a1a;margin:0 0 8px 0;">Leaderboard</h2>${leaderboardHtml}` : ""}

    <div style="text-align:center;margin:28px 0;">
      <a href="${primaryAction.href}" style="display:inline-block;background:#0E5C42;color:#FFFFFF;font-weight:700;font-size:15px;padding:12px 28px;border-radius:9px;text-decoration:none;">${escapeHtml(primaryAction.label)}</a>
    </div>

    <p class="email-muted" style="font-size:12px;color:#999999;margin:24px 0 4px 0;">
      You're receiving this because you have an active tip in ${safeEventName} and stage-result emails turned on.
      <a href="${preferencesUrl}" style="color:#1079BF;">Manage notification preferences</a>.
    </p>
    ${data.supportEmail ? `<p class="email-muted" style="font-size:12px;color:#999999;margin:0 0 4px 0;">Questions? Reply or contact <a href="mailto:${escapeHtml(data.supportEmail)}" style="color:#1079BF;">${escapeHtml(data.supportEmail)}</a>.</p>` : ""}
    <p class="email-muted" style="font-size:12px;color:#999999;margin:0;">${safeEventName}</p>
  </div>
</body>
</html>`.trim();

  const textLines = [
    `${data.eventName}`,
    `Stage ${data.stageNumber}${data.stageName ? `: ${data.stageName}` : ""}`,
    data.stageDateLabel ?? "",
    "",
    `Hi ${data.displayName}, here's how Stage ${data.stageNumber} went for you.`,
    "",
    `Stage score: ${data.stageScore}`,
    `Total score: ${data.totalScore}`,
    `Rank: ${data.currentRank}${participantsLabel}`,
    `Movement: ${movementBadge}`,
    "",
    "Your Top 5:",
    ...data.topFive.map(
      (row) =>
        `  ${row.predictedPosition}. ${row.riderName ?? "Not picked"} - ${row.actualPositionLabel} - ${row.points !== null ? `+${row.points}` : "-"} pts (${badgeTone(row.badge).label})`
    ),
    "",
    "Confirmed Stage Top 5:",
    ...data.actualTopFive.map((row) => `  ${row.position}. ${row.riderName}`),
    "",
    data.leaderboard
      ? [
          "Leaderboard:",
          ...data.leaderboard.map(
            (row) => `  ${row.rank}. ${row.displayName}${row.isCurrentUser ? " (you)" : ""} - ${row.totalScore} pts`
          ),
          data.scoreGapToNext !== null ? `  ${data.scoreGapToNext} point(s) to the next position.` : "",
        ].join("\n")
      : "",
    "",
    `${primaryAction.label}: ${primaryAction.href}`,
    "",
    `You're receiving this because you have an active tip in ${data.eventName} and stage-result emails turned on.`,
    `Manage notification preferences: ${preferencesUrl}`,
    data.supportEmail ? `Questions? Contact ${data.supportEmail}.` : "",
    data.eventName,
  ].filter((line) => line !== "");

  return { subject, preheader, html, text: textLines.join("\n") };
}
