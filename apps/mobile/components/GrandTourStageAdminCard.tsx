import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  applyGrandTourOfficialResult,
  correctGrandTourStageResult,
  finalizeGrandTourStage,
  getGrandTourStageAdminReviewDetails,
  markGrandTourStageChecked,
  runGrandTourOfficialCheck,
  scoreGrandTourStage,
  type GrandTourAdminJerseyHolder,
  type GrandTourAdminResultLine,
  type GrandTourOfficialCheckReport,
  type GrandTourStageAdminSummary
} from "@tipping-suite/supabase-client";

import {
  buildMarkCheckedConfirmationMessage,
  canFinalise,
  canMarkChecked,
  canScore,
  formatGrandTourAdminActionMessage,
  getGrandTourAdminActionLabel,
  getStageReviewWarnings,
  isStageDataComplete,
  type GrandTourAdminAction
} from "../lib/grandtourAdminExperience";
import {
  buildCorrectionConfirmationMessage,
  canApplyCorrection,
  computeCorrectionDiff,
  getCorrectionWarnings,
  parseCorrectionReport,
  type CorrectionDiff,
  type ParsedCorrectionReport
} from "../lib/grandtourCorrectionExperience";
import {
  buildApplyConfirmationMessage,
  canApplyOfficialResult,
  getOfficialCheckStatusMessage,
  summarizeOfficialCheckReport,
  type OfficialCheckSummary
} from "../lib/grandtourOfficialCheckExperience";
import { formatDateTime, formatShortDate, formatStageType } from "../lib/formatters";
import { ui } from "./theme";

const JERSEY_ORDER = ["yellow", "green", "kom", "white"] as const;
const JERSEY_LABELS: Record<(typeof JERSEY_ORDER)[number], string> = {
  yellow: "Yellow (GC)",
  green: "Green (Points)",
  kom: "KOM (Climber)",
  white: "White (Youth)"
};

type GrandTourStageAdminCardProps = {
  summary: GrandTourStageAdminSummary;
  currentUserId: string;
  grandTourName: string;
  grandTourYear: number;
  onActionComplete: () => void;
};

export function GrandTourStageAdminCard({ currentUserId, grandTourName, grandTourYear, onActionComplete, summary }: GrandTourStageAdminCardProps) {
  const [pendingAction, setPendingAction] = useState<GrandTourAdminAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rawResult, setRawResult] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [checkPending, setCheckPending] = useState(false);
  const [checkReport, setCheckReport] = useState<GrandTourOfficialCheckReport | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkExpanded, setCheckExpanded] = useState(false);

  const [applyPending, setApplyPending] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [confirmingApply, setConfirmingApply] = useState(false);

  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsLoaded, setDetailsLoaded] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [lines, setLines] = useState<GrandTourAdminResultLine[]>([]);
  const [jerseyHolders, setJerseyHolders] = useState<GrandTourAdminJerseyHolder[]>([]);

  const [confirmingMarkChecked, setConfirmingMarkChecked] = useState(false);

  const [updateExpanded, setUpdateExpanded] = useState(false);
  const [reportText, setReportText] = useState("");
  const [parsedReport, setParsedReport] = useState<ParsedCorrectionReport | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [diff, setDiff] = useState<CorrectionDiff | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [confirmingCorrection, setConfirmingCorrection] = useState(false);
  const [correctionPending, setCorrectionPending] = useState(false);
  const [correctionMessage, setCorrectionMessage] = useState<string | null>(null);
  const [correctionRawResult, setCorrectionRawResult] = useState<unknown>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  async function loadDetails() {
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const details = await getGrandTourStageAdminReviewDetails(summary.stageId);
      setLines(details.lines);
      setJerseyHolders(details.jerseyHolders);
      setDetailsLoaded(true);
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailsLoading(false);
    }
  }

  function toggleDetails() {
    const next = !detailsExpanded;
    setDetailsExpanded(next);
    if (next && !detailsLoaded && !detailsLoading) {
      void loadDetails();
    }
  }

  // Preview-only: fetches + reconciles the official result for this stage
  // via the server-side route (never runs in browser code) and displays it
  // for review. Never writes result lines/jersey holders, never marks
  // checked, never finalises, never scores - this is deliberately a
  // read-only, separate action from every RPC-backed button below.
  async function runOfficialCheck() {
    setCheckPending(true);
    setCheckError(null);
    try {
      const report = await runGrandTourOfficialCheck({
        grandTourName,
        grandTourYear,
        stageNumber: summary.stageNumber
      });
      setCheckReport(report);
      setCheckExpanded(true);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckPending(false);
    }
  }

  const checkSummary: OfficialCheckSummary | null = checkReport
    ? summarizeOfficialCheckReport(checkReport, summary.stageNumber)
    : null;
  const checkStatusMessage = checkSummary ? getOfficialCheckStatusMessage(checkSummary.safeToApply) : null;
  const applyEnabled = canApplyOfficialResult(checkSummary, summary.isFinal) && !applyPending;

  // Writes a DRAFT result (never finalises, never scores). Fetches fresh
  // server-side and re-validates before writing - see
  // apps/mobile/api/admin/grandtour/apply-official-result.mjs. Runs under
  // the signed-in admin's own session, never a service-role key.
  async function applyOfficialResult() {
    setApplyPending(true);
    setApplyError(null);
    setApplyMessage(null);
    try {
      const outcome = await applyGrandTourOfficialResult({
        grandTourName,
        grandTourYear,
        stageNumber: summary.stageNumber
      });
      setApplyMessage(outcome.message);
      // The applied result/jersey holders just changed in the DB - refresh
      // the summary counts and force Review Results to be reloaded before
      // Mark Checked can be re-enabled, matching the same rule a
      // correction already follows.
      setDetailsLoaded(false);
      onActionComplete();
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    } finally {
      setApplyPending(false);
    }
  }

  async function runAction(action: GrandTourAdminAction) {
    setPendingAction(action);
    setActionError(null);
    setMessage(null);
    setRawResult(null);

    try {
      let result: unknown;
      if (action === "mark-checked") {
        result = await markGrandTourStageChecked({
          checkedBy: currentUserId,
          stageId: summary.stageId,
          stageNumber: summary.stageNumber
        });
      } else if (action === "finalise") {
        result = await finalizeGrandTourStage({
          finalizedBy: currentUserId,
          stageId: summary.stageId,
          stageNumber: summary.stageNumber
        });
      } else {
        result = await scoreGrandTourStage({
          stageId: summary.stageId,
          stageNumber: summary.stageNumber
        });
      }
      setRawResult(result);
      setMessage(formatGrandTourAdminActionMessage(action, summary.stageNumber, result));
      // Refetch immediately so the displayed summary/gating never lags
      // behind what the RPC actually did (requirement #6).
      onActionComplete();
      // Result-line/jersey-holder detail can't change from these actions,
      // but the "reviewed" state should still reflect the just-acted-on
      // stage's current data next time it's expanded elsewhere.
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handlePreviewDiff() {
    setParseErrors([]);
    setDiff(null);
    setParsedReport(null);
    setCorrectionError(null);
    setCorrectionMessage(null);
    setCorrectionRawResult(null);

    // The diff needs the currently-stored result lines/jersey holders
    // (by rider id) - reuse the "Review Results" section's own load, so
    // there's exactly one code path that fetches current stage detail.
    if (!detailsLoaded && !detailsLoading) {
      await loadDetails();
    }

    const { report, errors } = parseCorrectionReport(reportText, summary.stageId, summary.stageNumber);
    if (errors.length > 0 || !report) {
      setParseErrors(errors);
      return;
    }
    setParsedReport(report);

    const currentByPosition = new Map(lines.map((line) => [line.position, line.riderId]));
    const currentByJerseyType = new Map(jerseyHolders.map((holder) => [holder.jerseyType, holder.riderId]));
    setDiff(computeCorrectionDiff(currentByPosition, currentByJerseyType, report));
  }

  async function handleApplyCorrection() {
    if (!parsedReport) return;
    setCorrectionPending(true);
    setCorrectionError(null);
    setCorrectionMessage(null);
    setCorrectionRawResult(null);

    try {
      const result = await correctGrandTourStageResult({
        stageId: summary.stageId,
        stageNumber: summary.stageNumber,
        resultLines: parsedReport.resultLines,
        jerseyHolders: parsedReport.jerseyHolders,
        reconciliation: parsedReport.reconciliation,
        reason: correctionReason
      });
      setCorrectionRawResult(result);
      setCorrectionMessage(`Correction applied for stage ${summary.stageNumber}. The stage now requires Mark Checked -> Finalise -> Score again.`);
      // Reset the preview state and refetch both the summary and the
      // review-detail section, since the underlying content just changed.
      setReportText("");
      setParsedReport(null);
      setDiff(null);
      setCorrectionReason("");
      setDetailsLoaded(false);
      onActionComplete();
      await loadDetails();
    } catch (error) {
      setCorrectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setCorrectionPending(false);
    }
  }

  const busy = pendingAction !== null;
  // Mark Checked additionally requires the review-detail section to have
  // been loaded and displayed at least once (requirement Part A #4) - the
  // underlying RPC gate (canMarkChecked) is unchanged and still enforced.
  const markCheckedEnabled = canMarkChecked(summary) && detailsLoaded && !busy;
  const warnings = getStageReviewWarnings(summary);
  const readyForAdminCheck = isStageDataComplete(summary) && canMarkChecked(summary);
  const correctionWarnings = getCorrectionWarnings(summary);
  const applyCorrectionEnabled = canApplyCorrection({
    safeToApply: parsedReport !== null && parseErrors.length === 0,
    diff,
    reason: correctionReason
  }) && !correctionPending;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Stage {summary.stageNumber}</Text>
        <Text style={styles.titleMeta}>{formatStageType(summary.stageType)} · {formatShortDate(summary.stageDate)}</Text>
      </View>

      <View style={styles.fieldsGrid}>
        <Field label="Stage result id" value={summary.stageResultId ?? "—"} />
        <Field label="is_final" value={String(summary.isFinal)} />
        <Field label="review_status" value={summary.reviewStatus ?? "—"} />
        <Field label="Result lines" value={String(summary.resultLineCount)} />
        <Field label="Jersey holders" value={String(summary.jerseyHolderCount)} />
        <Field label="Score rows" value={String(summary.scoreCount)} />
        <Field label="Total score" value={String(summary.totalScoreAwarded)} />
        <Field label="Top 5 score" value={String(summary.top5ScoreAwarded)} />
        <Field label="Jersey score" value={String(summary.jerseyScoreAwarded)} />
        <Field label="Bonus score" value={String(summary.bonusScoreAwarded)} />
        <Field label="Last applied" value={summary.lastAppliedAt ? formatDateTime(summary.lastAppliedAt) : "—"} />
      </View>

      {warnings.length > 0 ? (
        <View style={styles.warningBox}>
          {warnings.map((warning) => (
            <Text key={warning} style={styles.warningText}>⚠ {warning}</Text>
          ))}
        </View>
      ) : readyForAdminCheck ? (
        <View style={styles.readyBox}>
          <Text style={styles.readyText}>✓ Ready for admin check</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: checkPending }}
        disabled={checkPending}
        onPress={() => void runOfficialCheck()}
        style={[styles.button, styles.checkButton, checkPending && styles.buttonDisabled]}
      >
        {checkPending ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text style={styles.buttonText}>Run Official Check</Text>
        )}
      </Pressable>
      {checkError ? <Text style={styles.errorText}>{checkError}</Text> : null}

      {checkSummary ? (
        <>
          <Pressable accessibilityRole="button" onPress={() => setCheckExpanded((value) => !value)} style={styles.reviewToggle}>
            <Text style={styles.reviewToggleText}>
              {checkExpanded ? "Hide latest official check ▲" : "Latest official check ▼"}
            </Text>
          </Pressable>

          {checkExpanded ? (
            <View style={styles.reviewSection}>
              <View style={styles.fieldsGrid}>
                <Field label="Fetched at" value={checkSummary.fetchedAt ? formatDateTime(checkSummary.fetchedAt) : "—"} />
                <Field label="Stage" value={String(checkSummary.stageNumber)} />
                <Field label="Parser status" value={checkSummary.parserStatus ?? "—"} />
                <Field label="Parser drift detected" value={String(checkSummary.parserDriftDetected)} />
                <Field label="Safe to apply" value={checkSummary.safeToApply === null ? "—" : String(checkSummary.safeToApply)} />
                <Field label="Result lines" value={String(checkSummary.resultLineCount)} />
                <Field label="Jersey holders" value={String(checkSummary.jerseyHolderCount)} />
              </View>

              {checkStatusMessage ? (
                <View style={styles.readyBox}>
                  <Text style={styles.readyText}>✓ {checkStatusMessage}</Text>
                </View>
              ) : checkSummary.blockers.length > 0 ? (
                <View style={styles.warningBox}>
                  <Text style={styles.warningText}>⚠ Official check found blockers:</Text>
                  {checkSummary.blockers.map((blocker) => (
                    <Text key={blocker} style={styles.warningText}>• {blocker}</Text>
                  ))}
                </View>
              ) : null}

              {summary.isFinal ? (
                <Text style={styles.hintText}>This stage is already final; results cannot be applied here.</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !applyEnabled }}
                  disabled={!applyEnabled}
                  onPress={() => setConfirmingApply(true)}
                  style={[styles.button, styles.checkButton, !applyEnabled && styles.buttonDisabled]}
                >
                  {applyPending ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={[styles.buttonText, !applyEnabled && styles.buttonTextDisabled]}>Apply Official Result</Text>
                  )}
                </Pressable>
              )}
              {applyMessage ? <Text style={styles.successText}>{applyMessage}</Text> : null}
              {applyError ? <Text style={styles.errorText}>{applyError}</Text> : null}

              <Text style={styles.reviewHeading}>Parsed top 10 result lines</Text>
              {checkSummary.topResultLines.length === 0 ? (
                <Text style={styles.emptyCopy}>No result lines parsed.</Text>
              ) : (
                <View style={styles.table}>
                  {checkSummary.topResultLines.map((line) => (
                    <View key={`check-${line.position}-${line.riderName}`} style={styles.tableRow}>
                      <Text style={styles.tablePosition}>{line.position}</Text>
                      <Text style={styles.tableBib}>{line.bibNumber !== null ? `#${line.bibNumber}` : "—"}</Text>
                      <Text style={styles.tableRider}>{line.riderName}</Text>
                      <Text style={styles.tableTeam}>{line.teamName}</Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.reviewHeading}>Parsed jersey holders</Text>
              {checkSummary.jerseyHolders.length === 0 ? (
                <Text style={styles.emptyCopy}>No jersey holders parsed.</Text>
              ) : (
                <View style={styles.table}>
                  {checkSummary.jerseyHolders.map((holder) => (
                    <View key={`check-jersey-${holder.jerseyType}`} style={styles.tableRow}>
                      <Text style={styles.tableJersey}>{JERSEY_LABELS[holder.jerseyType as (typeof JERSEY_ORDER)[number]] ?? holder.jerseyType}</Text>
                      <Text style={styles.tableBib}>{holder.bibNumber !== null ? `#${holder.bibNumber}` : "—"}</Text>
                      <Text style={styles.tableRider}>{holder.riderName ?? "Not found"}</Text>
                      <Text style={styles.tableTeam}>{holder.teamName ?? "—"}</Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.reviewHeading}>Jersey fetch metadata</Text>
              {checkSummary.jerseyFetchMetadata.length === 0 ? (
                <Text style={styles.emptyCopy}>No jersey fetch diagnostics.</Text>
              ) : (
                checkSummary.jerseyFetchMetadata.map((entry) => (
                  <Text key={`jersey-status-${entry.jerseyType}`} style={styles.copy}>
                    {entry.jerseyType}: {entry.status}
                  </Text>
                ))
              )}
            </View>
          ) : null}
        </>
      ) : null}

      <Pressable accessibilityRole="button" onPress={toggleDetails} style={styles.reviewToggle}>
        <Text style={styles.reviewToggleText}>{detailsExpanded ? "Hide review details ▲" : "Review Results ▼"}</Text>
      </Pressable>

      {detailsExpanded ? (
        <View style={styles.reviewSection}>
          {detailsLoading ? <ActivityIndicator color={ui.colors.primary} /> : null}
          {detailsError ? (
            <View>
              <Text style={styles.errorText}>{detailsError}</Text>
              <Pressable accessibilityRole="button" onPress={() => void loadDetails()} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}
          {!detailsLoading && !detailsError && detailsLoaded ? (
            <>
              <Text style={styles.reviewHeading}>Official top 10 result lines</Text>
              {lines.length === 0 ? (
                <Text style={styles.emptyCopy}>No result lines loaded yet.</Text>
              ) : (
                <View style={styles.table}>
                  {lines.map((line) => (
                    <View key={`${line.position}-${line.riderName}`} style={styles.tableRow}>
                      <Text style={styles.tablePosition}>{line.position}</Text>
                      <Text style={styles.tableBib}>{line.bibNumber !== null ? `#${line.bibNumber}` : "—"}</Text>
                      <Text style={styles.tableRider}>{line.riderName}</Text>
                      <Text style={styles.tableTeam}>{line.teamName ?? "—"}</Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.reviewHeading}>Official jersey holders</Text>
              {jerseyHolders.length === 0 ? (
                <Text style={styles.emptyCopy}>No jersey holders loaded yet.</Text>
              ) : (
                <View style={styles.table}>
                  {JERSEY_ORDER.map((jerseyType) => {
                    const holder = jerseyHolders.find((entry) => entry.jerseyType === jerseyType);
                    return (
                      <View key={jerseyType} style={styles.tableRow}>
                        <Text style={styles.tableJersey}>{JERSEY_LABELS[jerseyType]}</Text>
                        <Text style={styles.tableBib}>{holder?.bibNumber !== undefined && holder?.bibNumber !== null ? `#${holder.bibNumber}` : "—"}</Text>
                        <Text style={styles.tableRider}>{holder?.riderName ?? "Not loaded"}</Text>
                        <Text style={styles.tableTeam}>{holder?.teamName ?? "—"}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          ) : null}
        </View>
      ) : null}

      <Pressable accessibilityRole="button" onPress={() => setUpdateExpanded((value) => !value)} style={styles.reviewToggle}>
        <Text style={styles.reviewToggleText}>{updateExpanded ? "Hide Update Results ▲" : "Update Results / Re-run Official Import ▼"}</Text>
      </Pressable>

      {updateExpanded ? (
        <View style={styles.reviewSection}>
          <Text style={styles.copy}>
            Run a fresh dry-run/reconcile on the CLI (node scripts/grandtour-feed-import.mjs --dry-run --reconcile --stage {summary.stageNumber}),
            then paste the resulting report JSON below to preview a diff against the currently stored result.
          </Text>

          {correctionWarnings.length > 0 ? (
            <View style={styles.warningBox}>
              {correctionWarnings.map((warning) => (
                <Text key={warning} style={styles.warningText}>⚠ {warning}</Text>
              ))}
            </View>
          ) : null}

          <TextInput
            multiline
            onChangeText={setReportText}
            placeholder="Paste the fresh --reconcile report JSON here"
            style={styles.reportInput}
            value={reportText}
          />
          <Pressable accessibilityRole="button" onPress={() => void handlePreviewDiff()} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Preview Diff</Text>
          </Pressable>

          {parseErrors.length > 0 ? (
            <View style={styles.warningBox}>
              {parseErrors.map((parseError) => (
                <Text key={parseError} style={styles.warningText}>⚠ {parseError}</Text>
              ))}
            </View>
          ) : null}

          {diff ? (
            <View style={styles.reviewSection}>
              <Text style={styles.reviewHeading}>
                {!diff.resultLinesChanged && !diff.jerseyHoldersChanged
                  ? "No differences from the currently stored result."
                  : "Differences from the currently stored result:"}
              </Text>
              {diff.changedLines.map((line) => (
                <Text key={`line-${line.position}`} style={styles.copy}>
                  Position {line.position}: {line.currentRiderId ?? "(none)"} → {line.incomingRiderId ?? "(none)"}
                </Text>
              ))}
              {diff.changedJerseys.map((jersey) => (
                <Text key={`jersey-${jersey.jerseyType}`} style={styles.copy}>
                  {jersey.jerseyType}: {jersey.currentRiderId ?? "(none)"} → {jersey.incomingRiderId ?? "(none)"}
                </Text>
              ))}

              <Text style={styles.reviewHeading}>Reason for this correction (required)</Text>
              <TextInput
                onChangeText={setCorrectionReason}
                placeholder="e.g. official feed had the wrong stage winner"
                style={styles.reasonInput}
                value={correctionReason}
              />

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !applyCorrectionEnabled }}
                disabled={!applyCorrectionEnabled}
                onPress={() => setConfirmingCorrection(true)}
                style={[styles.button, !applyCorrectionEnabled && styles.buttonDisabled]}
              >
                {correctionPending ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={[styles.buttonText, !applyCorrectionEnabled && styles.buttonTextDisabled]}>Apply Correction</Text>
                )}
              </Pressable>
            </View>
          ) : null}

          {correctionMessage ? <Text style={styles.successText}>{correctionMessage}</Text> : null}
          {correctionRawResult !== null ? <Text style={styles.rawResult}>{JSON.stringify(correctionRawResult, null, 2)}</Text> : null}
          {correctionError ? <Text style={styles.errorText}>{correctionError}</Text> : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        <ActionButton
          enabled={markCheckedEnabled}
          label={getGrandTourAdminActionLabel("mark-checked")}
          onPress={() => setConfirmingMarkChecked(true)}
          pending={pendingAction === "mark-checked"}
        />
        <ActionButton
          enabled={canFinalise(summary) && !busy}
          label={getGrandTourAdminActionLabel("finalise")}
          onPress={() => void runAction("finalise")}
          pending={pendingAction === "finalise"}
        />
        <ActionButton
          enabled={canScore(summary) && !busy}
          label={getGrandTourAdminActionLabel("score")}
          onPress={() => void runAction("score")}
          pending={pendingAction === "score"}
        />
      </View>
      {!detailsLoaded && canMarkChecked(summary) ? (
        <Text style={styles.hintText}>Expand "Review Results" above to enable Mark Checked.</Text>
      ) : null}

      {message ? <Text style={styles.successText}>{message}</Text> : null}
      {rawResult !== null ? <Text style={styles.rawResult}>{JSON.stringify(rawResult, null, 2)}</Text> : null}
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setConfirmingMarkChecked(false)}
        transparent
        visible={confirmingMarkChecked}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirm Mark Checked</Text>
            <Text style={styles.modalCopy}>{buildMarkCheckedConfirmationMessage(summary.stageNumber)}</Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirmingMarkChecked(false)}
                style={styles.modalCancelButton}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setConfirmingMarkChecked(false);
                  void runAction("mark-checked");
                }}
                style={styles.modalConfirmButton}
              >
                <Text style={styles.modalConfirmText}>Confirm</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setConfirmingApply(false)}
        transparent
        visible={confirmingApply}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirm Apply Official Result</Text>
            <Text style={styles.modalCopy}>{buildApplyConfirmationMessage(summary.stageNumber)}</Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirmingApply(false)}
                style={styles.modalCancelButton}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setConfirmingApply(false);
                  void applyOfficialResult();
                }}
                style={styles.modalConfirmButton}
              >
                <Text style={styles.modalConfirmText}>Confirm</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setConfirmingCorrection(false)}
        transparent
        visible={confirmingCorrection}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirm Update Results</Text>
            <Text style={styles.modalCopy}>{buildCorrectionConfirmationMessage(summary.stageNumber)}</Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirmingCorrection(false)}
                style={styles.modalCancelButton}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setConfirmingCorrection(false);
                  void handleApplyCorrection();
                }}
                style={styles.modalConfirmButton}
              >
                <Text style={styles.modalConfirmText}>Confirm</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function ActionButton({
  enabled,
  label,
  onPress,
  pending
}: {
  enabled: boolean;
  label: string;
  onPress: () => void;
  pending: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={[styles.button, !enabled && styles.buttonDisabled]}
    >
      {pending ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <Text style={[styles.buttonText, !enabled && styles.buttonTextDisabled]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14
  },
  button: {
    alignItems: "center",
    backgroundColor: ui.colors.primary,
    borderRadius: ui.radius.medium,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 8
  },
  buttonDisabled: {
    backgroundColor: ui.colors.border
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center"
  },
  buttonTextDisabled: {
    color: ui.colors.muted
  },
  checkButton: {
    marginTop: 12
  },
  copy: {
    color: ui.colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  reasonInput: {
    borderColor: ui.colors.border,
    borderRadius: ui.radius.small,
    borderWidth: 1,
    color: ui.colors.ink,
    fontSize: 13,
    marginTop: 4,
    minHeight: 40,
    paddingHorizontal: 10
  },
  reportInput: {
    borderColor: ui.colors.border,
    borderRadius: ui.radius.small,
    borderWidth: 1,
    color: ui.colors.ink,
    fontFamily: "monospace",
    fontSize: 11,
    marginTop: 6,
    minHeight: 90,
    padding: 8,
    textAlignVertical: "top"
  },
  card: {
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.large,
    borderWidth: 1,
    padding: 16,
    ...ui.shadow
  },
  emptyCopy: {
    color: ui.colors.muted,
    fontSize: 13,
    fontStyle: "italic"
  },
  errorText: {
    color: ui.colors.danger,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10
  },
  field: {
    minWidth: "45%"
  },
  fieldLabel: {
    color: ui.colors.muted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  fieldValue: {
    color: ui.colors.ink,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 2
  },
  fieldsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 10
  },
  hintText: {
    color: ui.colors.muted,
    fontSize: 12,
    fontStyle: "italic",
    marginTop: 6
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16
  },
  modalCancelButton: {
    alignItems: "center",
    borderColor: ui.colors.border,
    borderRadius: ui.radius.medium,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46
  },
  modalCancelText: {
    color: ui.colors.ink,
    fontWeight: "800"
  },
  modalCard: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.large,
    maxWidth: 420,
    padding: 20,
    width: "100%"
  },
  modalConfirmButton: {
    alignItems: "center",
    backgroundColor: ui.colors.primary,
    borderRadius: ui.radius.medium,
    flex: 1,
    justifyContent: "center",
    minHeight: 46
  },
  modalConfirmText: {
    color: "#FFFFFF",
    fontWeight: "800"
  },
  modalCopy: {
    color: ui.colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8
  },
  modalOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(15, 36, 26, 0.55)",
    flex: 1,
    justifyContent: "center",
    padding: 20
  },
  modalTitle: {
    color: ui.colors.ink,
    fontSize: 18,
    fontWeight: "900"
  },
  rawResult: {
    backgroundColor: ui.colors.surfaceMuted,
    borderRadius: ui.radius.small,
    color: ui.colors.ink,
    fontFamily: "monospace",
    fontSize: 11,
    marginTop: 8,
    padding: 8
  },
  readyBox: {
    backgroundColor: ui.colors.primarySoft,
    borderRadius: ui.radius.small,
    marginTop: 10,
    padding: 10
  },
  readyText: {
    color: ui.colors.success,
    fontSize: 12,
    fontWeight: "800"
  },
  retryButton: {
    alignSelf: "flex-start",
    marginTop: 6
  },
  retryButtonText: {
    color: ui.colors.primary,
    fontSize: 12,
    fontWeight: "800"
  },
  reviewHeading: {
    color: ui.colors.ink,
    fontSize: 13,
    fontWeight: "900",
    marginTop: 10
  },
  reviewSection: {
    gap: 6,
    marginTop: 10
  },
  reviewToggle: {
    marginTop: 12
  },
  reviewToggleText: {
    color: ui.colors.primary,
    fontSize: 13,
    fontWeight: "800"
  },
  successText: {
    color: ui.colors.success,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 10
  },
  table: {
    backgroundColor: ui.colors.surfaceMuted,
    borderRadius: ui.radius.small,
    overflow: "hidden"
  },
  tableBib: {
    color: ui.colors.muted,
    fontSize: 12,
    fontWeight: "800",
    width: 44
  },
  tableJersey: {
    color: ui.colors.ink,
    fontSize: 12,
    fontWeight: "800",
    width: 110
  },
  tablePosition: {
    color: ui.colors.ink,
    fontSize: 12,
    fontWeight: "900",
    width: 22
  },
  tableRider: {
    color: ui.colors.ink,
    flex: 1,
    fontSize: 12,
    fontWeight: "700"
  },
  tableRow: {
    borderBottomColor: ui.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  tableTeam: {
    color: ui.colors.muted,
    fontSize: 11,
    fontWeight: "700",
    width: 90
  },
  title: {
    color: ui.colors.ink,
    fontSize: 18,
    fontWeight: "900"
  },
  titleMeta: {
    color: ui.colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  warningBox: {
    backgroundColor: ui.colors.warningSoft,
    borderRadius: ui.radius.small,
    marginTop: 10,
    padding: 10
  },
  warningText: {
    color: ui.colors.warning,
    fontSize: 12,
    fontWeight: "800"
  }
});
