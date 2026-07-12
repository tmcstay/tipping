/**
 * Turns a scripts/grandtour-auto-dry-run.mjs final-summary.json into a
 * plain-English admin notification email, and (as a CLI) prepares that
 * email for the "Send admin notification email" step in
 * .github/workflows/grandtour-auto-dry-run.yml.
 *
 * Only genuine terminal outcomes page the admin: a real success, or a real
 * final failure. "no_eligible_stage" is a routine daily outcome (nothing to
 * check yet - rest day, still within the grace window, etc.) and never
 * sends an email, so the admin isn't paged every day for a non-event.
 *
 * Never reads or includes any secret - only fields already present in
 * final-summary.json, which itself never contains credentials.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OUTCOME_COPY = {
  success: {
    emoji: "✅",
    subjectLabel: "check succeeded",
    outcomeLine: (stageDescription) =>
      `The automatic results check for ${stageDescription} completed successfully. The parsed results look safe to apply.`
  },
  unsafe_review_required: {
    emoji: "⚠️",
    subjectLabel: "needs manual review",
    outcomeLine: (stageDescription) =>
      `The automatic results check for ${stageDescription} fetched results, but they are NOT safe to apply automatically. A human needs to review them before anyone applies this stage's result.`
  },
  parser_drift: {
    emoji: "🛠️",
    subjectLabel: "letour.fr page format may have changed",
    outcomeLine: (stageDescription) =>
      `The parser could not read letour.fr's page for ${stageDescription} the way it expects to. This usually means letour.fr changed their page layout, and the scraper (scripts/grandtour-feed-provider.mjs) needs a developer to update it.`
  },
  configuration_error: {
    emoji: "🛑",
    subjectLabel: "could not run - configuration problem",
    outcomeLine: (stageDescription) =>
      `The automatic results check for ${stageDescription} could not even start, due to a configuration problem (for example, missing Supabase credentials in GitHub Actions secrets). No data was fetched.`
  },
  transient_failure_exhausted: {
    emoji: "🔁",
    subjectLabel: "failed after repeated retries",
    outcomeLine: (stageDescription, finalSummary) =>
      `The automatic results check for ${stageDescription} kept hitting temporary network/connection problems and gave up after ${finalSummary.attemptsMade} attempt(s) (1 initial + up to ${finalSummary.maxRetries} retries). This is usually caused by a temporary outage on letour.fr or Supabase, and often resolves itself on the next scheduled run.`
  },
  unexpected_failure: {
    emoji: "❗",
    subjectLabel: "failed unexpectedly",
    outcomeLine: (stageDescription) =>
      `The automatic results check for ${stageDescription} failed with an error that doesn't match any known, expected failure type. This needs a developer to look at the run logs.`
  }
};

function describeStage(finalSummary) {
  if (finalSummary.stageNumber != null) return `Stage ${finalSummary.stageNumber}`;
  if (finalSummary.fromStage != null && finalSummary.toStage != null) return `Stages ${finalSummary.fromStage}-${finalSummary.toStage}`;
  return "the requested stage";
}

/**
 * Returns { subject, body } for a notification email, or null if this
 * outcome should not page anyone. `finalSummary` is the parsed
 * final-summary.json, optionally extended with a `runUrl` field (not part
 * of final-summary.json itself) pointing at the GitHub Actions run.
 */
export function buildNotificationEmail(finalSummary) {
  const copy = OUTCOME_COPY[finalSummary.finalStatus];
  if (!copy) return null; // no_eligible_stage, or any future/unknown status - never page for these

  const tour = `${finalSummary.grandTourName} ${finalSummary.grandTourYear}`;
  const stageDescription = describeStage(finalSummary);

  const subject = `[GrandTour] ${copy.emoji} ${stageDescription} ${copy.subjectLabel} (${tour})`;

  const lines = [copy.outcomeLine(stageDescription, finalSummary), ""];
  lines.push(`Grand tour: ${tour}`);
  lines.push(`Provider: ${finalSummary.provider}`);
  lines.push(`Attempts made: ${finalSummary.attemptsMade}`);
  if (finalSummary.safeToApply !== null && finalSummary.safeToApply !== undefined) {
    lines.push(`Safe to apply: ${finalSummary.safeToApply}`);
  }
  if (finalSummary.parserDriftDetected) lines.push("Parser drift detected: true");
  if (finalSummary.blockers && finalSummary.blockers.length > 0) {
    lines.push("", "Blockers:");
    for (const blocker of finalSummary.blockers) lines.push(`  - ${blocker}`);
  }
  if (finalSummary.finalError) lines.push("", `Error: ${finalSummary.finalError}`);
  lines.push("", `Run ID: ${finalSummary.runId}`);
  if (finalSummary.runUrl) lines.push(`View full run: ${finalSummary.runUrl}`);
  lines.push(
    "",
    "This is an automated message from the GrandTour auto dry-run workflow. It never applies, finalises, or scores results - it only checks and reports."
  );

  return { subject, body: lines.join("\n") };
}

async function main(argv = process.argv.slice(2)) {
  const summaryPath = argv[0];
  if (!summaryPath || summaryPath.startsWith("--")) {
    throw new Error("Usage: grandtour-auto-dry-run-notify.mjs <final-summary.json> [--run-url <url>] [--out-dir <dir>]");
  }

  const runUrlIndex = argv.indexOf("--run-url");
  const runUrl = runUrlIndex !== -1 ? argv[runUrlIndex + 1] : null;
  const outDirIndex = argv.indexOf("--out-dir");
  const outDir = outDirIndex !== -1 ? argv[outDirIndex + 1] : ".";

  const finalSummary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
  const email = buildNotificationEmail({ ...finalSummary, runUrl });

  const outputsPath = process.env.GITHUB_OUTPUT;

  if (!email) {
    console.log(`No notification email needed for finalStatus: ${finalSummary.finalStatus}`);
    if (outputsPath) await fs.appendFile(outputsPath, "should_send=false\n", "utf8");
    return;
  }

  await fs.mkdir(outDir, { recursive: true });
  const bodyPath = path.join(outDir, "notify-email-body.txt");
  await fs.writeFile(bodyPath, `${email.body}\n`, "utf8");

  console.log("Notification email prepared.");
  console.log(`Subject: ${email.subject}`);
  console.log(`Body path: ${bodyPath}`);

  if (outputsPath) {
    await fs.appendFile(
      outputsPath,
      `should_send=true\nsubject=${email.subject}\nbody_path=${bodyPath}\n`,
      "utf8"
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  });
}
