import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  finalizeGrandTourStage,
  markGrandTourStageChecked,
  scoreGrandTourStage,
  type GrandTourStageAdminSummary
} from "@tipping-suite/supabase-client";

import {
  canFinalise,
  canMarkChecked,
  canScore,
  formatGrandTourAdminActionMessage,
  getGrandTourAdminActionLabel,
  type GrandTourAdminAction
} from "../lib/grandtourAdminExperience";
import { ui } from "./theme";

type GrandTourStageAdminCardProps = {
  summary: GrandTourStageAdminSummary;
  currentUserId: string;
  onActionComplete: () => void;
};

export function GrandTourStageAdminCard({ currentUserId, onActionComplete, summary }: GrandTourStageAdminCardProps) {
  const [pendingAction, setPendingAction] = useState<GrandTourAdminAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rawResult, setRawResult] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  const busy = pendingAction !== null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Stage {summary.stageNumber}</Text>

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
      </View>

      <View style={styles.actions}>
        <ActionButton
          enabled={canMarkChecked(summary) && !busy}
          label={getGrandTourAdminActionLabel("mark-checked")}
          onPress={() => void runAction("mark-checked")}
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

      {message ? <Text style={styles.successText}>{message}</Text> : null}
      {rawResult !== null ? <Text style={styles.rawResult}>{JSON.stringify(rawResult, null, 2)}</Text> : null}
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
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
  card: {
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.large,
    borderWidth: 1,
    padding: 16,
    ...ui.shadow
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
  rawResult: {
    backgroundColor: ui.colors.surfaceMuted,
    borderRadius: ui.radius.small,
    color: ui.colors.ink,
    fontFamily: "monospace",
    fontSize: 11,
    marginTop: 8,
    padding: 8
  },
  successText: {
    color: ui.colors.success,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 10
  },
  title: {
    color: ui.colors.ink,
    fontSize: 18,
    fontWeight: "900"
  }
});
