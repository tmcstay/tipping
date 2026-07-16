import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppShell } from "../../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/DataState";
import { GrandTourResultsSummary } from "../../components/GrandTourResultsSummary";
import { GrandTourStageResultAccordion } from "../../components/GrandTourStageResultAccordion";
import { ui } from "../../components/theme";
import {
  useCyclingCompetition,
  useCyclingLeaderboard,
  useCyclingStageResults,
  useTdf2026Stages,
  useTdfRiders,
  useTdfTeams
} from "../../hooks/useCyclingData";
import { useParticipantGrandTourStageTips } from "../../hooks/useGrandTourTips";
import { formatGrandTourName } from "../../lib/grandTourDisplay";
import { computeHistorySummary, type HistoryStageScoreRow } from "../../lib/grandtourHistoryExperience";
import { formatRankMovement } from "../../lib/leaderboardExperience";
import { getStageTipExperience } from "../../lib/stageExperience";
import { selectStartedStagesDescending } from "../../lib/stageListExperience";

/**
 * Read-only detail view of another participant's tipping record: display
 * name, current overall rank/points/movement, and one collapsed-by-default
 * accordion per stage they've actually tipped, most recent first.
 *
 * Privacy is enforced at the database layer, not by anything in this
 * screen: listParticipantGrandTourStageTips queries `grandtour_tips` for
 * the target user_id with no status/date filtering of its own - RLS
 * (20260702003948_harden_grandtour_tip_lifecycle.sql's "own or post-lock
 * eligible" policy) is what actually determines which of that user's rows
 * come back. A draft, or a submitted-but-not-yet-locked tip for a stage
 * that hasn't closed, is never returned by Postgres in the first place -
 * this screen has no client-side "hide future tips" logic to get wrong,
 * because there is nothing to hide by the time the data arrives. The
 * "started stages only" filter below is a display-ordering choice (a
 * not-yet-started stage never has a visible tip anyway, so it would only
 * ever render an empty card), not a second, redundant privacy control.
 */
export default function ParticipantDetailScreen() {
  const params = useLocalSearchParams<{ userId: string }>();
  const userId = Array.isArray(params.userId) ? params.userId[0] : params.userId;

  const { race, stages } = useTdf2026Stages();
  const competition = useCyclingCompetition(race.data?.id);
  const results = useCyclingStageResults(race.data?.id);
  const leaderboard = useCyclingLeaderboard(competition.data?.id, "overall");
  const { riders } = useTdfRiders();
  const { teams } = useTdfTeams();
  const participantTips = useParticipantGrandTourStageTips(userId, competition.data?.id);

  const now = useMemo(() => new Date(), []);

  const participant = leaderboard.data?.find((row) => row.user_id === userId) ?? null;

  const riderLookup = useMemo(() => {
    const teamNameById = new Map((teams.data ?? []).map((team) => [team.id, team.name]));
    const byId = new Map((riders.data ?? []).map((rider) => [
      rider.id,
      { name: rider.display_name, bibNumber: rider.bib_number, teamName: rider.team_id ? teamNameById.get(rider.team_id) ?? null : null }
    ]));
    return (id: string) => byId.get(id) ?? null;
  }, [riders.data, teams.data]);

  // Most recent completed/active stage first; a stage that hasn't started
  // yet is never included - its tip (if any) would be invisible via RLS
  // regardless, and there is nothing to review about a stage that hasn't
  // raced.
  const stageRows = useMemo(() => selectStartedStagesDescending(
    (stages.data ?? []).map((stage) => ({ stage, startsAt: stage.starts_at, stageNumber: stage.stage_number })),
    now
  )
    .map(({ stage }) => {
      const tip = (participantTips.data ?? []).find((candidate) => candidate.stage_id === stage.id) ?? null;
      const officialResult = (results.data ?? []).find((candidate) => candidate.stage_id === stage.id) ?? null;
      return { stage, tip, officialResult, isTtt: getStageTipExperience(stage.stage_type).isTtt };
    }), [stages.data, participantTips.data, results.data, now]);

  const historyRows: HistoryStageScoreRow[] = useMemo(() => stageRows.map(({ stage, tip }) => ({
    stageId: stage.id,
    stageNumber: stage.stage_number,
    totalScore: tip?.status === "scored" ? tip.total_score : null,
    top5Score: tip?.score?.top5_score ?? null,
    jerseyScore: tip?.score?.jersey_score ?? null,
    bonusScore: tip?.score?.bonus_score ?? null
  })), [stageRows]);

  const summary = useMemo(() => computeHistorySummary(historyRows), [historyRows]);

  const loading = race.loading || stages.loading || competition.loading || leaderboard.loading
    || participantTips.loading || results.loading || riders.loading || teams.loading;
  const error = race.error ?? stages.error ?? competition.error ?? leaderboard.error
    ?? participantTips.error ?? results.error;

  return (
    <AppShell
      raceName={formatGrandTourName(race.data)}
      subtitle="Tips and scores for every completed stage."
      title={participant ? participant.display_name : "Participant"}
    >
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} onRetry={() => { race.reload(); stages.reload(); leaderboard.reload(); participantTips.reload(); results.reload(); }} /> : null}
      {!loading && !error && !userId ? <EmptyState message="No participant was specified." /> : null}
      {!loading && !error && userId && !participant ? (
        <EmptyState message="This participant could not be found on the leaderboard." />
      ) : null}

      {!loading && !error && participant ? (
        <>
          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={styles.statusStat}>
                <Text style={styles.statusValue}>#{participant.rank}</Text>
                <Text style={styles.statusLabel}>Rank</Text>
              </View>
              <View style={styles.statusStat}>
                <Text style={styles.statusValue}>{participant.total_score}</Text>
                <Text style={styles.statusLabel}>Points</Text>
              </View>
              <View style={styles.statusStat}>
                <Text style={styles.statusValue}>{formatRankMovement(participant.rank, participant.previous_rank)}</Text>
                <Text style={styles.statusLabel}>Movement</Text>
              </View>
              <View style={styles.statusStat}>
                <Text style={styles.statusValue}>{participant.stages_tipped}</Text>
                <Text style={styles.statusLabel}>Stages tipped</Text>
              </View>
            </View>
          </View>

          {stageRows.length > 0 ? <GrandTourResultsSummary summary={summary} /> : null}

          {stageRows.length === 0 ? (
            <EmptyState message="No completed stages yet." />
          ) : (
            stageRows.map(({ isTtt, officialResult, stage, tip }) => (
              <GrandTourStageResultAccordion
                isTtt={isTtt}
                key={stage.id}
                officialResult={officialResult}
                riderLookup={riderLookup}
                stageDate={stage.starts_at}
                stageName={stage.stage_name}
                stageNumber={stage.stage_number}
                stageType={stage.stage_type}
                tip={tip}
              />
            ))
          )}
        </>
      ) : null}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  statusCard: {
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.large,
    borderWidth: 1,
    padding: 16,
    shadowColor: ui.shadow.shadowColor,
    shadowOffset: ui.shadow.shadowOffset,
    shadowOpacity: ui.shadow.shadowOpacity,
    shadowRadius: ui.shadow.shadowRadius
  },
  statusLabel: { color: ui.colors.muted, fontSize: 11, fontWeight: "500", marginTop: 2, textAlign: "center" },
  statusRow: { flexDirection: "row" },
  statusStat: { alignItems: "center", flex: 1 },
  statusValue: { color: ui.colors.ink, fontSize: 22, fontVariant: ["tabular-nums"], fontWeight: "700" }
});
