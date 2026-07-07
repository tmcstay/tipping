import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CyclingStage } from "@tipping-suite/supabase-client";

import { useAuth } from "../auth/useAuth";
import { AppShell } from "../components/AppShell";
import { DashboardStatCard } from "../components/DashboardStatCard";
import { InfoCard } from "../components/InfoCard";
import { JerseyHolderCard, type JerseyKind } from "../components/JerseyHolderCard";
import { LockCountdownCard } from "../components/LockCountdownCard";
import { StageTypeBadge } from "../components/StageTypeBadge";
import { TipStatusBadge, type TipDisplayStatus } from "../components/TipStatusBadge";
import { ui } from "../components/theme";
import {
  useCyclingCompetition,
  useCyclingLeaderboard,
  useCyclingStageResults,
  useTdf2026Stages
} from "../hooks/useCyclingData";
import { useStageTipDraft } from "../hooks/useGrandTourTips";
import { formatShortDate, formatTime } from "../lib/formatters";
import { getStageTipExperience } from "../lib/stageExperience";

const jerseyOrder: JerseyKind[] = ["yellow", "green", "kom", "white"];

function getDashboardStage(stages: CyclingStage[] | null | undefined) {
  if (!stages?.length) return null;
  const now = Date.now();
  return stages.find((stage) => new Date(stage.starts_at).getTime() >= now)
    ?? stages[stages.length - 1];
}

function resolveTipStatus(status: string | undefined | null, locked: boolean): TipDisplayStatus {
  if (status && ["draft", "submitted", "locked", "scored", "corrected", "voided", "deleted"].includes(status)) {
    return status as TipDisplayStatus;
  }
  return locked ? "missed" : "not_started";
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { race, stages } = useTdf2026Stages();
  const stage = getDashboardStage(stages.data);
  const competition = useCyclingCompetition(race.data?.id);
  const results = useCyclingStageResults(race.data?.id);
  const currentTip = useStageTipDraft({ competitionId: competition.data?.id, stageId: stage?.id, tipMode: "daily" });
  const leaderboard = useCyclingLeaderboard(competition.data?.id, "overall");
  const leader = leaderboard.data?.[0] ?? null;
  const me = leaderboard.data?.find((row) => row.user_id === user?.id) ?? null;
  const latestResult = [...(results.data ?? [])].sort((a, b) => {
    const aNumber = stages.data?.find((candidate) => candidate.id === a.stage_id)?.stage_number ?? 0;
    const bNumber = stages.data?.find((candidate) => candidate.id === b.stage_id)?.stage_number ?? 0;
    return bNumber - aNumber;
  })[0] ?? null;
  const latestStage = stages.data?.find((candidate) => candidate.id === latestResult?.stage_id) ?? null;
  const latestTip = useStageTipDraft({ competitionId: competition.data?.id, stageId: latestStage?.id, tipMode: "daily" });
  const locked = Boolean(stage?.locks_at && new Date(stage.locks_at).getTime() <= Date.now());
  const displayStatus = resolveTipStatus(currentTip.data?.status, locked);
  const experience = getStageTipExperience(stage?.stage_type);
  const stageWinner = latestResult
    ? (latestResult.teamResults.find((line) => line.actual_position === 1)?.team.name
      ?? latestResult.riderResults.find((line) => line.actual_position === 1)?.rider.display_name)
    : null;

  return (
    <AppShell title="Dashboard" subtitle="Your race day, tips, and league — all in one place.">
      <InfoCard accent title={stage ? `Stage ${stage.stage_number}: ${stage.start_location ?? "TBC"} → ${stage.finish_location ?? "TBC"}` : "No active stage"} meta={stage ? formatShortDate(stage.starts_at) : "Today’s stage"}>
        {stage ? (
          <>
            <View style={styles.heroTopRow}>
              <StageTypeBadge stageType={stage.stage_type} />
              <Text style={styles.heroDistance}>{stage.distance_km ? `${stage.distance_km} km` : "Distance TBC"}</Text>
            </View>
            {experience.isTtt ? <View style={styles.tttBanner}><Text style={styles.tttText}>Team Time Trial — pick teams for the stage result</Text></View> : null}
            <Text style={styles.heroCopy}>{experience.topFiveCopy}</Text>
            <View style={styles.heroStatusRow}>
              <TipStatusBadge status={displayStatus} />
              <Text style={styles.heroLock}>{locked ? "Tips locked" : `Locks ${formatTime(stage.locks_at)}`}</Text>
            </View>
            <Pressable onPress={() => router.push(`/stages/${stage.id}`)} style={styles.heroButton}>
              <Text style={styles.heroButtonText}>{locked ? "View Tips" : currentTip.data?.status === "submitted" ? "Edit Tips" : currentTip.data?.status === "draft" ? "Finish Draft" : "Enter Tips"}</Text>
            </Pressable>
          </>
        ) : <Text style={styles.heroCopy}>No active stage is available yet.</Text>}
      </InfoCard>

      {stage ? <LockCountdownCard locksAt={stage.locks_at} /> : null}

      <View style={styles.statGrid}>
        <DashboardStatCard label="My position" value={me ? `#${me.rank}` : "—"} helper={me ? `${me.total_score} points` : "Appears after scoring"} />
        <DashboardStatCard label="Behind leader" value={me && leader ? `${Math.max(0, leader.total_score - me.total_score)}` : "—"} helper="points" />
        <DashboardStatCard label="Last stage" value={latestTip.data?.score ? `+${latestTip.data.score.total_score}` : "—"} helper="points scored" />
      </View>

      <InfoCard title="Current jersey holders" meta={latestStage ? `After stage ${latestStage.stage_number}` : "Awaiting results"}>
        <View style={styles.jerseyGrid}>
          {jerseyOrder.map((jersey) => {
            const rider = latestResult?.jerseyResults.find((entry) => entry.jersey_type === jersey)?.rider;
            return <JerseyHolderCard jersey={jersey} key={jersey} riderName={rider?.display_name} teamName={rider?.team?.name} />;
          })}
        </View>
      </InfoCard>

      <InfoCard title="Latest result" meta={latestStage ? `Stage ${latestStage.stage_number}` : "No result yet"}>
        {latestStage && latestResult ? (
          <>
            <View style={styles.resultTopRow}><StageTypeBadge stageType={latestStage.stage_type} /><Text style={styles.resultPoints}>{latestTip.data?.score ? `You scored ${latestTip.data.score.total_score}` : "Score pending"}</Text></View>
            <Text style={styles.resultLabel}>{getStageTipExperience(latestStage.stage_type).isTtt ? "Winning team" : "Stage winner"}</Text>
            <Text style={styles.resultWinner}>{stageWinner ?? "Pending"}</Text>
            <Pressable onPress={() => router.push("/results")} style={styles.textButton}><Text style={styles.textButtonText}>View full results →</Text></Pressable>
          </>
        ) : <Text style={styles.copy}>No official stage results are available yet.</Text>}
      </InfoCard>

      <InfoCard title="Mini leaderboard" meta={competition.data?.name ?? "Overall"}>
        {leaderboard.data?.slice(0, 5).map((row) => {
          const currentUser = row.user_id === user?.id;
          return <View key={row.id} style={[styles.leaderRow, currentUser && styles.currentUserRow]}>
            <View style={styles.rankBubble}><Text style={styles.rankText}>{row.rank}</Text></View>
            <View style={styles.leaderCopy}><Text style={styles.leaderName}>{row.display_name}{currentUser ? " (You)" : ""}</Text><Text style={styles.leaderMeta}>{row.stages_tipped} stages tipped</Text></View>
            <Text style={styles.leaderPoints}>{row.total_score}</Text>
          </View>;
        })}
        {!leaderboard.loading && !leaderboard.error && !leaderboard.data?.length ? <Text style={styles.copy}>Leaderboard appears after the first scoring run.</Text> : null}
        <Pressable onPress={() => router.push("/leaderboard")} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>View full leaderboard</Text></Pressable>
      </InfoCard>

      <InfoCard title="Upcoming stages" meta="Next on the road">
        {(stages.data ?? []).filter((candidate) => new Date(candidate.starts_at).getTime() > Date.now()).slice(0, 3).map((candidate) => (
          <Pressable key={candidate.id} onPress={() => router.push(`/stages/${candidate.id}`)} style={styles.upcomingRow}>
            <View style={styles.stageNumber}><Text style={styles.stageNumberText}>{candidate.stage_number}</Text></View>
            <View style={styles.leaderCopy}><Text style={styles.leaderName}>{candidate.start_location ?? "TBC"} → {candidate.finish_location ?? "TBC"}</Text><Text style={styles.leaderMeta}>{formatShortDate(candidate.starts_at)}</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </InfoCard>

      <Text style={styles.disclaimer}>GrandTour Tips is an independent cycling tipping app and is not affiliated with a race organiser.</Text>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  chevron: { color: ui.colors.muted, fontSize: 26 },
  copy: { color: ui.colors.muted, fontSize: 14, lineHeight: 20 },
  currentUserRow: { backgroundColor: ui.colors.primarySoft, borderRadius: ui.radius.small, paddingHorizontal: 8 },
  disclaimer: { color: ui.colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  heroButton: { alignItems: "center", backgroundColor: ui.colors.accent, borderRadius: ui.radius.medium, justifyContent: "center", minHeight: 54, marginTop: 4, paddingHorizontal: 16 },
  heroButtonText: { color: ui.colors.primary, fontSize: 16, fontWeight: "900" },
  heroCopy: { color: "#E7F1EA", fontSize: 15, lineHeight: 22 },
  heroDistance: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  heroLock: { color: "#E7F1EA", flex: 1, fontSize: 12, fontWeight: "800", textAlign: "right" },
  heroStatusRow: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  heroTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  jerseyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  leaderCopy: { flex: 1 },
  leaderMeta: { color: ui.colors.muted, fontSize: 12, marginTop: 2 },
  leaderName: { color: ui.colors.ink, fontSize: 14, fontWeight: "900" },
  leaderPoints: { color: ui.colors.primary, fontSize: 18, fontWeight: "900" },
  leaderRow: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 48 },
  rankBubble: { alignItems: "center", backgroundColor: ui.colors.primarySoft, borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  rankText: { color: ui.colors.primary, fontWeight: "900" },
  resultLabel: { color: ui.colors.muted, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  resultPoints: { color: ui.colors.success, fontSize: 12, fontWeight: "900" },
  resultTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  resultWinner: { color: ui.colors.primary, fontSize: 22, fontWeight: "900" },
  secondaryButton: { alignItems: "center", borderColor: ui.colors.primary, borderRadius: ui.radius.medium, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 16 },
  secondaryButtonText: { color: ui.colors.primary, fontWeight: "900" },
  stageNumber: { alignItems: "center", backgroundColor: ui.colors.primary, borderRadius: 12, height: 40, justifyContent: "center", width: 40 },
  stageNumberText: { color: "#FFFFFF", fontWeight: "900" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  textButton: { alignSelf: "flex-start", minHeight: 38, justifyContent: "center" },
  textButtonText: { color: ui.colors.primary, fontWeight: "900" },
  tttBanner: { alignSelf: "flex-start", backgroundColor: ui.colors.tttSoft, borderRadius: ui.radius.pill, paddingHorizontal: 11, paddingVertical: 7 },
  tttText: { color: ui.colors.ttt, fontSize: 12, fontWeight: "900" },
  upcomingRow: { alignItems: "center", borderBottomColor: ui.colors.border, borderBottomWidth: 1, flexDirection: "row", gap: 10, minHeight: 58 }
});
