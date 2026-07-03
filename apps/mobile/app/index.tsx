import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppShell } from "../components/AppShell";
import { DashboardStatCard } from "../components/DashboardStatCard";
import { InfoCard } from "../components/InfoCard";
import { StageTypeBadge } from "../components/StageTypeBadge";
import { TipStatusBadge, type TipDisplayStatus } from "../components/TipStatusBadge";
import {
  useCyclingCompetition,
  useCyclingLeaderboard,
  useTdf2026Stages
} from "../hooks/useCyclingData";
import { useStageTipDraft } from "../hooks/useGrandTourTips";
import { activeAppConfig } from "../lib/appConfig";
import {
  formatDateTime,
  formatDurationUntil,
  formatShortDate,
  formatStageType,
  formatTime
} from "../lib/formatters";
import { getStageTipExperience } from "../lib/stageExperience";

function getNextStage<T extends { starts_at: string }>(stages: T[] | undefined) {
  if (!stages?.length) return null;
  return stages.find((stage) => new Date(stage.starts_at).getTime() > Date.now()) ?? stages[0];
}

function resolveTipStatus(status: string | undefined | null, locked: boolean): TipDisplayStatus {
  if (status && ["draft", "submitted", "locked", "scored", "corrected", "voided", "deleted"].includes(status)) {
    return status as TipDisplayStatus;
  }
  return locked ? "missed" : "not_started";
}

export default function HomeScreen() {
  const router = useRouter();
  const { race, stages } = useTdf2026Stages();
  const nextStage = getNextStage(stages.data);
  const competition = useCyclingCompetition(race.data?.id);
  const currentTip = useStageTipDraft({
    competitionId: competition.data?.id,
    stageId: nextStage?.id,
    tipMode: "daily"
  });
  const leaderboard = useCyclingLeaderboard(competition.data?.id, "overall");
  const leader = leaderboard.data?.[0] ?? null;
  const currentUserRank = leaderboard.data?.find((row) => !row.is_dummy) ?? null;
  const locked = Boolean(nextStage?.locks_at && new Date(nextStage.locks_at).getTime() <= Date.now());
  const displayStatus = resolveTipStatus(currentTip.data?.status, locked);
  const experience = getStageTipExperience(nextStage?.stage_type);

  return (
    <AppShell
      title="Race dashboard"
      subtitle="Today’s stage, your tip status, and the league at a glance."
    >
      <InfoCard
        accent
        title={nextStage ? `Stage ${nextStage.stage_number}: ${nextStage.start_location ?? "TBC"} → ${nextStage.finish_location ?? "TBC"}` : "Tour de France 2026"}
        meta={nextStage ? formatShortDate(nextStage.starts_at) : "Today"}
      >
        {nextStage ? (
          <>
            <View style={styles.heroTopRow}>
              <StageTypeBadge stageType={nextStage.stage_type} />
              <Text style={styles.heroDistance}>{nextStage.distance_km ? `${nextStage.distance_km} km` : "Distance TBC"}</Text>
            </View>
            <Text style={styles.heroCopy}>
              {experience.isTtt
                ? "Pick the top 5 teams for the stage result. Jerseys are still individual riders."
                : "Pick your top 5 riders, then choose the jersey holders."}
            </Text>
            <View style={styles.heroStatusRow}>
              <TipStatusBadge status={displayStatus} />
              <Text style={styles.heroLock}>Locks {formatTime(nextStage.locks_at)} · {formatDurationUntil(nextStage.locks_at)}</Text>
            </View>
            <Pressable
              onPress={() => router.push(`/stages/${nextStage.id}`)}
              style={styles.heroButton}
            >
              <Text style={styles.heroButtonText}>
                {locked ? "View Tips" : currentTip.data?.status === "submitted" ? "Edit Tips" : "Enter Tips"}
              </Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.heroCopy}>Import the race stages to activate the daily tipping dashboard.</Text>
        )}
      </InfoCard>

      <View style={styles.statGrid}>
        <DashboardStatCard
          label="Tip status"
          value={currentTip.data?.status === "submitted" ? "Submitted" : currentTip.data?.status === "draft" ? "Draft" : locked ? "Locked" : "Open"}
          helper={currentTip.data?.status === "draft" ? "Drafts do not score until submitted" : nextStage ? formatDurationUntil(nextStage.locks_at) : undefined}
        />
        <DashboardStatCard
          label="My position"
          value={currentUserRank ? `${currentUserRank.rank}` : "—"}
          helper={currentUserRank ? `${currentUserRank.total_score} pts` : "Appears after scoring"}
        />
      </View>

      <InfoCard title="Current race" meta={race.data?.data_confidence ?? "2026 race"}>
        <View style={styles.raceRows}>
          <Text style={styles.copy}>{race.data?.name ?? "Tour de France 2026"}</Text>
          <Text style={styles.copy}>{stages.data?.length ?? 21} stages · {race.data?.countries?.join(" / ") ?? "Spain to Paris"}</Text>
          {nextStage ? <Text style={styles.copy}>Next start: {formatDateTime(nextStage.starts_at)}</Text> : null}
        </View>
        {race.error || stages.error ? (
          <Text style={styles.note}>
            Connect Supabase and import the 2026 dataset to load live stage data.
          </Text>
        ) : null}
      </InfoCard>

      <InfoCard title="Mini leaderboard" meta={competition.data?.name ?? "Overall"}>
        {leaderboard.data?.slice(0, 5).map((row) => (
          <View key={row.id} style={styles.leaderRow}>
            <View style={styles.rankBubble}><Text style={styles.rankText}>{row.rank}</Text></View>
            <View style={styles.leaderCopy}>
              <Text style={styles.leaderName}>{row.display_name}</Text>
              <Text style={styles.leaderMeta}>{row.stages_tipped} stages tipped{row.is_dummy ? " · Dummy" : ""}</Text>
            </View>
            <Text style={styles.leaderPoints}>{row.total_score}</Text>
          </View>
        ))}
        {!leaderboard.loading && !leaderboard.error && !leaderboard.data?.length ? (
          <Text style={styles.copy}>Leaderboard appears after the first scoring run.</Text>
        ) : null}
        <Pressable onPress={() => router.push("/leaderboard")} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>View full leaderboard</Text>
        </Pressable>
      </InfoCard>

      <InfoCard title="Scoring snapshot" meta="Rules">
        <Text style={styles.copy}>Stage Top 5 exact positions: 10 · 8 · 6 · 4 · 2 points.</Text>
        <Text style={styles.copy}>Wrong position inside the actual Top 5: 1 point.</Text>
        <Text style={styles.copy}>Daily jerseys: 5 each · Overall jerseys: 25 each.</Text>
        {nextStage && getStageTipExperience(nextStage.stage_type).isTtt ? (
          <Text style={styles.note}>TTT stage result uses teams. Yellow jersey still uses the official individual rider holder.</Text>
        ) : null}
      </InfoCard>

      <View style={styles.actions}>
        <Pressable
          onPress={() => router.push("/stages")}
          style={[styles.primaryButton, { backgroundColor: activeAppConfig.theme.secondaryColor }]}
        >
          <Text style={styles.primaryButtonText}>Open all stages</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/overall-jerseys")} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Overall jersey tips</Text>
        </Pressable>
      </View>

      <Text style={styles.disclaimer}>
        GrandTour Tips is an independent cycling tipping app and is not an
        official race-organiser product.
      </Text>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
  copy: { color: "#425047", fontSize: 15, lineHeight: 22 },
  disclaimer: { color: "#6B746E", fontSize: 12, lineHeight: 18, textAlign: "center" },
  heroButton: {
    alignItems: "center",
    backgroundColor: "#F4C430",
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 52,
    marginTop: 4,
    paddingHorizontal: 16
  },
  heroButtonText: { color: "#12372A", fontSize: 16, fontWeight: "900" },
  heroCopy: { color: "#E7F1EA", fontSize: 15, lineHeight: 22 },
  heroDistance: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  heroLock: { color: "#E7F1EA", flex: 1, fontSize: 12, fontWeight: "800", textAlign: "right" },
  heroStatusRow: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  heroTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  leaderCopy: { flex: 1 },
  leaderMeta: { color: "#6B746E", fontSize: 12, marginTop: 2 },
  leaderName: { color: "#17231C", fontSize: 15, fontWeight: "900" },
  leaderPoints: { color: "#12372A", fontSize: 18, fontWeight: "900" },
  leaderRow: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 44 },
  note: { color: "#8A5A00", fontSize: 13, fontWeight: "800", lineHeight: 19, marginTop: 4 },
  primaryButton: {
    alignItems: "center",
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16
  },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "900" },
  raceRows: { gap: 4 },
  rankBubble: { alignItems: "center", backgroundColor: "#EAF2ED", borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  rankText: { color: "#12372A", fontWeight: "900" },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#12372A",
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16
  },
  secondaryButtonText: { color: "#12372A", fontWeight: "900" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }
});
