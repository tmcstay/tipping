import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import {
  confirmGrandTourRiderMasterLink,
  resolveUciRiderReviewItem,
  type GrandTourRiderRecord,
  type UciRiderRecord,
  type UciRiderReviewQueueItem
} from "@tipping-suite/supabase-client";

import {
  buildConfirmConfirmationMessage,
  canConfirmMatch,
  extractCandidateRiderIds,
  formatQueueTypeLabel
} from "../lib/uciRiderReviewExperience";
import { ui } from "./theme";

type UciRiderReviewCardProps = {
  currentUserId: string;
  item: UciRiderReviewQueueItem;
  sourceRider: GrandTourRiderRecord | null;
  candidates: UciRiderRecord[];
  onActionComplete: () => void;
};

/**
 * The expanded body of one review-queue accordion card: a side-by-side
 * comparison (Tour entry vs candidate UCI rider(s)) plus the four review
 * actions, modeled directly on GrandTourStageAdminCard's confirm-modal +
 * ActionButton pattern (one `confirming*` boolean + Modal per action).
 */
export function UciRiderReviewCard({ candidates, currentUserId, item, onActionComplete, sourceRider }: UciRiderReviewCardProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [confirmingMatch, setConfirmingMatch] = useState(false);
  const [saveAsAlias, setSaveAsAlias] = useState(false);

  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [confirmingIgnore, setConfirmingIgnore] = useState(false);

  const [flagExpanded, setFlagExpanded] = useState(false);
  const [flagNote, setFlagNote] = useState("");
  const [confirmingFlag, setConfirmingFlag] = useState(false);

  const candidateIds = extractCandidateRiderIds(item);
  const singleCandidate = candidates.length === 1 ? candidates[0] : null;
  const matchEnabled = canConfirmMatch(item) && Boolean(singleCandidate) && !pendingAction;

  const entryPayload = (item.candidatePayload && typeof item.candidatePayload === "object" && !Array.isArray(item.candidatePayload)
    ? (item.candidatePayload as Record<string, unknown>)
    : {}) as { entryName?: string; entryTeamName?: string; entryNationality?: string; entryBibNumber?: number };

  async function handleConfirmMatch() {
    if (!singleCandidate) return;
    setPendingAction("confirm");
    setActionError(null);
    setMessage(null);
    try {
      await confirmGrandTourRiderMasterLink({
        confirmedBy: currentUserId,
        createAlias: saveAsAlias && sourceRider
          ? { aliasText: sourceRider.displayName, aliasType: "race_organiser", riderId: singleCandidate.id }
          : null,
        grandtourRiderId: item.grandtourRiderId ?? sourceRider?.id ?? "",
        note: "Confirmed via UCI rider review page",
        reviewItemId: item.id,
        uciRiderId: singleCandidate.id
      });
      setMessage(`Linked ${sourceRider?.displayName ?? "this rider"} to ${singleCandidate.displayName}.`);
      onActionComplete();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleResolve(status: "new_rider_approved" | "ignored" | "source_correction", note: string | null) {
    setPendingAction(status);
    setActionError(null);
    setMessage(null);
    try {
      await resolveUciRiderReviewItem({ itemId: item.id, note, resolvedBy: currentUserId, status });
      setMessage(`Marked ${status.replace(/_/g, " ")}.`);
      onActionComplete();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionHeading}>Tour entry</Text>
      <View style={styles.comparisonRow}>
        <Field label="Name" value={sourceRider?.displayName ?? entryPayload.entryName ?? "Unknown"} />
        <Field label="Team" value={entryPayload.entryTeamName ?? "—"} />
        <Field label="Nationality" value={entryPayload.entryNationality ?? "—"} />
        <Field label="Bib" value={entryPayload.entryBibNumber !== undefined ? String(entryPayload.entryBibNumber) : "—"} />
      </View>

      <Text style={styles.sectionHeading}>
        Candidate UCI rider{candidates.length === 1 ? "" : "s"} ({candidateIds.length})
      </Text>
      {candidates.length === 0 ? (
        <Text style={styles.emptyCopy}>No candidate identity found - see "Flag for source correction" or "Approve as new rider" below.</Text>
      ) : (
        candidates.map((candidate) => {
          const nationalityMismatch = Boolean(
            entryPayload.entryNationality && candidate.nationality && entryPayload.entryNationality !== candidate.nationality
          );
          return (
            <View key={candidate.id} style={styles.candidateCard}>
              <Field label="Name" value={candidate.displayName} />
              <Field label="Nationality" value={candidate.nationality ?? "—"} valueStyle={nationalityMismatch ? styles.mismatch : undefined} />
              <Field label="Team" value={candidate.currentTeamName ?? "—"} />
              <Field label="DOB" value={candidate.dateOfBirth ?? "—"} />
              <Field label="UCI id" value={candidate.uciRiderId ?? "—"} />
            </View>
          );
        })
      )}

      {item.reason ? <Text style={styles.reasonText}>Reason: {item.reason}</Text> : null}

      {candidates.length === 1 && saveAsAlias !== undefined ? (
        <View style={styles.aliasRow}>
          <Switch onValueChange={setSaveAsAlias} value={saveAsAlias} />
          <Text style={styles.aliasLabel}>Also save "{sourceRider?.displayName ?? entryPayload.entryName ?? ""}" as an alias</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <ActionButton
          enabled={matchEnabled}
          label="Confirm match"
          onPress={() => setConfirmingMatch(true)}
          pending={pendingAction === "confirm"}
        />
        <ActionButton
          enabled={!pendingAction}
          label="Approve as new rider"
          onPress={() => setConfirmingApprove(true)}
          pending={pendingAction === "new_rider_approved"}
        />
        <ActionButton
          enabled={!pendingAction}
          label="Ignore"
          onPress={() => setConfirmingIgnore(true)}
          pending={pendingAction === "ignored"}
        />
      </View>

      <Pressable accessibilityRole="button" onPress={() => setFlagExpanded((value) => !value)} style={styles.flagToggle}>
        <Text style={styles.flagToggleText}>{flagExpanded ? "Hide flag for source correction ▲" : "Flag for source correction ▼"}</Text>
      </Pressable>
      {flagExpanded ? (
        <View style={styles.flagSection}>
          <TextInput
            multiline
            onChangeText={setFlagNote}
            placeholder="Required: describe the source data problem (e.g. letour.fr misspelled this name)"
            style={styles.flagInput}
            value={flagNote}
          />
          <ActionButton
            enabled={!pendingAction && flagNote.trim().length > 0}
            label="Flag for source correction"
            onPress={() => setConfirmingFlag(true)}
            pending={pendingAction === "source_correction"}
          />
        </View>
      ) : null}

      {message ? <Text style={styles.successText}>{message}</Text> : null}
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

      <ConfirmModal
        cancel={() => setConfirmingMatch(false)}
        confirm={() => {
          setConfirmingMatch(false);
          void handleConfirmMatch();
        }}
        message={buildConfirmConfirmationMessage(item)}
        title="Confirm Match"
        visible={confirmingMatch}
      />
      <ConfirmModal
        cancel={() => setConfirmingApprove(false)}
        confirm={() => {
          setConfirmingApprove(false);
          void handleResolve("new_rider_approved", null);
        }}
        message={`Approve "${sourceRider?.displayName ?? entryPayload.entryName ?? "this rider"}" as a genuinely new rider with no existing UCI identity match.`}
        title="Approve as New Rider"
        visible={confirmingApprove}
      />
      <ConfirmModal
        cancel={() => setConfirmingIgnore(false)}
        confirm={() => {
          setConfirmingIgnore(false);
          void handleResolve("ignored", null);
        }}
        message={`Ignore this review item (${formatQueueTypeLabel(item.queueType)}). It will no longer appear in the pending queue.`}
        title="Ignore"
        visible={confirmingIgnore}
      />
      <ConfirmModal
        cancel={() => setConfirmingFlag(false)}
        confirm={() => {
          setConfirmingFlag(false);
          void handleResolve("source_correction", flagNote.trim());
        }}
        message={`Flag this item for a source-data correction. Note: "${flagNote.trim()}"`}
        title="Flag for Source Correction"
        visible={confirmingFlag}
      />
    </View>
  );
}

function Field({ label, value, valueStyle }: { label: string; value: string; valueStyle?: object }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, valueStyle]}>{value}</Text>
    </View>
  );
}

function ActionButton({ enabled, label, onPress, pending }: { enabled: boolean; label: string; onPress: () => void; pending: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={[styles.button, !enabled && styles.buttonDisabled]}
    >
      {pending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={[styles.buttonText, !enabled && styles.buttonTextDisabled]}>{label}</Text>}
    </Pressable>
  );
}

function ConfirmModal({
  cancel,
  confirm,
  message,
  title,
  visible
}: {
  cancel: () => void;
  confirm: () => void;
  message: string;
  title: string;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" onRequestClose={cancel} transparent visible={visible}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.modalCopy}>{message}</Text>
          <View style={styles.modalActions}>
            <Pressable accessibilityRole="button" onPress={cancel} style={styles.modalCancelButton}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={confirm} style={styles.modalConfirmButton}>
              <Text style={styles.modalConfirmText}>Confirm</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: 8, marginTop: 14 },
  aliasLabel: { color: ui.colors.muted, flex: 1, fontSize: 12, fontWeight: "600" },
  aliasRow: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 10 },
  button: {
    alignItems: "center",
    backgroundColor: ui.colors.primary,
    borderRadius: ui.radius.medium,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 8
  },
  buttonDisabled: { backgroundColor: ui.colors.border },
  buttonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", textAlign: "center" },
  buttonTextDisabled: { color: ui.colors.muted },
  candidateCard: {
    backgroundColor: ui.colors.surfaceMuted,
    borderRadius: ui.radius.small,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
    padding: 10
  },
  card: { paddingTop: 4 },
  comparisonRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 },
  emptyCopy: { color: ui.colors.muted, fontSize: 13, fontStyle: "italic", marginTop: 6 },
  errorText: { color: ui.colors.danger, fontSize: 13, lineHeight: 18, marginTop: 10 },
  field: { minWidth: "40%" },
  fieldLabel: { color: ui.colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  fieldValue: { color: ui.colors.ink, fontSize: 13, fontWeight: "700", marginTop: 2 },
  flagInput: {
    borderColor: ui.colors.border,
    borderRadius: ui.radius.small,
    borderWidth: 1,
    color: ui.colors.ink,
    fontSize: 13,
    minHeight: 60,
    padding: 8,
    textAlignVertical: "top"
  },
  flagSection: { gap: 8, marginTop: 8 },
  flagToggle: { marginTop: 12 },
  flagToggleText: { color: ui.colors.primary, fontSize: 13, fontWeight: "800" },
  mismatch: { color: ui.colors.danger },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  modalCancelButton: {
    alignItems: "center",
    borderColor: ui.colors.border,
    borderRadius: ui.radius.medium,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46
  },
  modalCancelText: { color: ui.colors.ink, fontWeight: "800" },
  modalCard: { backgroundColor: ui.colors.surface, borderRadius: ui.radius.large, maxWidth: 420, padding: 20, width: "100%" },
  modalConfirmButton: {
    alignItems: "center",
    backgroundColor: ui.colors.primary,
    borderRadius: ui.radius.medium,
    flex: 1,
    justifyContent: "center",
    minHeight: 46
  },
  modalConfirmText: { color: "#FFFFFF", fontWeight: "800" },
  modalCopy: { color: ui.colors.muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  modalOverlay: { alignItems: "center", backgroundColor: "rgba(15, 36, 26, 0.55)", flex: 1, justifyContent: "center", padding: 20 },
  modalTitle: { color: ui.colors.ink, fontSize: 18, fontWeight: "900" },
  reasonText: { color: ui.colors.warning, fontSize: 12, fontWeight: "700", marginTop: 8 },
  sectionHeading: { color: ui.colors.ink, fontSize: 13, fontWeight: "900", marginTop: 10 },
  successText: { color: ui.colors.success, fontSize: 13, fontWeight: "700", marginTop: 10 }
});
