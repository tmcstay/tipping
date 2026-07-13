import { isStageEligibleForResults, resolveCyclingStageClosureState, selectLatestEligibleStage } from "@tipping-suite/tipping-core";
import { Redirect, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CyclingStage, CyclingStageResult } from "@tipping-suite/supabase-client";

import { useAuth } from "../auth/useAuth";
import { AppShell } from "../components/AppShell";
import { DashboardStatCard } from "../components/DashboardStatCard";
import { EmptyState, ErrorState, SkeletonCard, SkeletonStatGrid } from "../components/DataState";
import { InfoCard } from "../components/InfoCard";
import { JerseyHolderCard, type JerseyKind } from "../components/JerseyHolderCard";
import { LockCountdownCard } from "../components/LockCountdownCard";
import { StageStatusBadge } from "../components/StageStatusBadge";
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
import { formatDateTime, formatShortDate } from "../lib/formatters";
import { getStageTipExperience } from "../lib/stageExperience";
import {
  buildClosureDisplay,
  buildHistoryStatCardLink,
  buildJerseyDashboardCardLink,
  buildLeaderboardDashboardCardLink,
  buildRankStatCardLink,
  buildSelectionProgressLabel,
  buildStageDashboardCardLink
} from "../lib/stageClosureExperience";

const jerseyOrder: JerseyKind[] = ["yellow", "green", "kom", "white"];

function resolveTipStatus(status: string | undefined | null, locked: boolean): TipDisplayStatus {
  if (status && ["draft", "submitted", "locked", "scored", "corrected", "voided", "deleted"].includes(status)) {
    return status as TipDisplayStatus;
  }
  return locked ? "missed" : "not_started";
}

function getStageWinnerName(result: CyclingStageResult | null | undefined): string | null {
  if (!result) return null;
  return (
    result.teamResults.find((line) => line.actual_position === 1)?.team.name
    ?? result.riderResults.find((line) => line.actual_position === 1)?.rider.display_name
    ?? null
  );
}

type StageClosure = {
  stage: CyclingStage;
  result: CyclingStageResult | null;
  isFinal: boolean;
  closureState: ReturnType<typeof resolveCyclingStageClosureState>;
};

/**
 * "/" is now owned by exactly one screen (this one), registered
 * unconditionally in app/_layout.tsx - never inside a Stack.Protected
 * group. Previously both this screen (guard={Boolean(user)...}) and
 * app/(auth)/index.tsx (guard={!user...}) were registered for the exact
 * same bare path "/" (route groups like "(auth)" don't add a URL segment),
 * differentiated only by which guard was active. In production that dual
 * registration produced a tight, permanent client-side navigation loop at
 * "/" - confirmed with a real browser (Playwright): "/login" (a single,
 * unambiguous path) loaded cleanly, while "/" fired hundreds of same-URL
 * history navigations per second and never settled. Fixed by removing the
 * ambiguity entirely: this screen alone decides what "/" shows, using a
 * declarative <Redirect> (not an imperative router.replace() call, which
 * has its own known Expo Router timing hazard - see AuthCallbackScreen.tsx)
 * when there's no authenticated session.
 */
export default function HomeScreen() {
  const { isPasswordRecovery, user } = useAuth();
  if (!user || isPasswordRecovery) {
    return <Redirect href="/login" />;
  }
  return <AuthenticatedDashboard />;
}

function AuthenticatedDashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const { race, stages } = useTdf2026Stages();
  const competition = useCyclingCompetition(race.data?.id);
  const results = useCyclingStageResults(race.data?.id);
  const leaderboard = useCyclingLeaderboard(competition.data?.id, "overall");

  // Resolved once and reused for every stage's closure calculation this
  // render - never re-read the clock partway through building the page.
  const now = new Date();

  const stagesWithClosure: StageClosure[] = (stages.data ?? []).map((stage) => {
    const result = results.data?.find((candidate) => candidate.stage_id === stage.id) ?? null;
    const isFinal = Boolean(result);
    const closureState = resolveCyclingStageClosureState({
      startsAt: stage.starts_at,
      locksAt: stage.locks_at,
      manualLockedAt: stage.manual_locked_at,
      isFinal,
      now
    });
    return { stage, result, isFinal, closureState };
  });

  // Position 1/2: whichever needs the user's attention first - the soonest
  // stage still open (or closing soon) for tipping, or (if none are open)
  // a stage that's actually live right now.
  const actionCandidates = stagesWithClosure
    .filter((entry) => entry.closureState === "open" || entry.closureState === "closing_soon")
    .sort((a, b) => new Date(a.stage.starts_at).getTime() - new Date(b.stage.starts_at).getTime());
  const liveCandidates = stagesWithClosure.filter((entry) => entry.closureState === "live");
  const hero = actionCandidates[0] ?? liveCandidates[0] ?? null;

  // Position 3: the latest result-eligible stage, via the shared,
  // deterministic tipping-core selector - never a future stage, never a
  // stage row treated as a result merely because it exists.
  const eligibilityCandidates = (stages.data ?? []).map((stage) => ({
    stageId: stage.id,
    stageNumber: stage.stage_number,
    startsAt: stage.starts_at,
    isFinal: Boolean(results.data?.some((result) => result.stage_id === stage.id))
  }));
  const latestEligible = selectLatestEligibleStage(eligibilityCandidates, now);
  const latestStage = latestEligible ? stages.data?.find((candidate) => candidate.id === latestEligible.stageId) ?? null : null;
  const latestResult = latestStage ? results.data?.find((candidate) => candidate.stage_id === latestStage.id) ?? null : null;

  const competitionId = competition.data?.id;
  const currentTip = useStageTipDraft({ competitionId, stageId: hero?.stage.id, tipMode: "daily" });
  const latestTip = useStageTipDraft({ competitionId, stageId: latestStage?.id, tipMode: "daily" });

  const leader = leaderboard.data?.[0] ?? null;
  const me = leaderboard.data?.find((row) => row.user_id === user?.id) ?? null;

  // Position 5: upcoming stages, excluding whatever is already shown as
  // the hero so the same stage never appears twice on the first screen.
  const upcomingStages = stagesWithClosure
    .filter((entry) => new Date(entry.stage.starts_at).getTime() > now.getTime() && entry.stage.id !== hero?.stage.id)
    .sort((a, b) => new Date(a.stage.starts_at).getTime() - new Date(b.stage.starts_at).getTime())
    .slice(0, 3);

  // Position 6: recent results, excluding the one already shown as
  // "latest completed stage" above - same eligibility rule, just the next
  // few instead of only the most recent.
  const recentResults = eligibilityCandidates
    .filter((candidate) => candidate.isFinal && candidate.stageId !== latestStage?.id && isStageEligibleForResults(candidate, now))
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())
    .slice(0, 3)
    .map((candidate) => ({
      stage: stages.data?.find((s) => s.id === candidate.stageId) ?? null,
      result: results.data?.find((r) => r.stage_id === candidate.stageId) ?? null
    }))
    .filter((entry): entry is { stage: CyclingStage; result: CyclingStageResult } => Boolean(entry.stage && entry.result));

  const heroDisplay = hero
    ? buildClosureDisplay({
        state: hero.closureState,
        locksAt: hero.stage.locks_at,
        now,
        formattedLockDateTime: formatDateTime(hero.stage.locks_at),
        hasDraftInProgress: currentTip.data?.status === "draft",
        hasSubmittedTip: currentTip.data?.status === "submitted"
      })
    : null;
  const heroExperience = hero ? getStageTipExperience(hero.stage.stage_type) : null;
  const heroDisplayStatus = hero ? resolveTipStatus(currentTip.data?.status, !(heroDisplay?.editable ?? false)) : "not_started";
  const heroLink = hero
    ? buildStageDashboardCardLink({
        stageId: hero.stage.id,
        stageNumber: hero.stage.stage_number,
        startLocation: hero.stage.start_location,
        finishLocation: hero.stage.finish_location,
        statusLabel: heroDisplay?.badgeLabel ?? "",
        ctaLabel: heroDisplay?.ctaLabel ?? "View stage"
      })
    : null;

  const initialLoading = race.loading || stages.loading;
  const initialError = race.error ?? stages.error;

  const latestResultLink = latestStage
    ? buildStageDashboardCardLink({
        stageId: latestStage.id,
        stageNumber: latestStage.stage_number,
        startLocation: latestStage.start_location,
        finishLocation: latestStage.finish_location,
        statusLabel: "Completed",
        ctaLabel: "View result"
      })
    : null;
  const leaderboardLink = buildLeaderboardDashboardCardLink(competition.data?.name ?? null);
  const rankLink = buildRankStatCardLink();
  const historyLink = buildHistoryStatCardLink();

  return (
    <AppShell title="Dashboard" subtitle="Your race day, tips, and league — all in one place.">
      {initialLoading ? (
        <>
          <SkeletonCard lines={4} />
          <SkeletonStatGrid />
          <SkeletonCard lines={2} />
        </>
      ) : null}

      {initialError ? <ErrorState error={initialError} onRetry={() => { race.reload(); stages.reload(); }} /> : null}

      {!initialLoading && !initialError ? (
        <>
          {/* Position 1/2: action required, or live */}
          {hero && heroDisplay && heroExperience && heroLink ? (
            <InfoCard
              accent
              accessibilityHint={heroLink.accessibilityHint}
              accessibilityLabel={heroLink.accessibilityLabel}
              href={heroLink.href}
              meta={formatShortDate(hero.stage.starts_at)}
              title={`Stage ${hero.stage.stage_number}: ${hero.stage.start_location ?? "TBC"} → ${hero.stage.finish_location ?? "TBC"}`}
            >
              <View style={styles.heroTopRow}>
                <StageTypeBadge stageType={hero.stage.stage_type} />
                <Text style={styles.heroDistance}>{hero.stage.distance_km ? `${hero.stage.distance_km} km` : "Distance TBC"}</Text>
              </View>
              {heroExperience.isTtt ? (
                <View style={styles.tttBanner}>
                  <Text style={styles.tttText}>Team Time Trial — pick teams for the stage result</Text>
                </View>
              ) : null}
              <View style={styles.heroStatusRow}>
                <StageStatusBadge emphasis={heroDisplay.emphasis} label={heroDisplay.badgeLabel} tone={hero.closureState} />
                <TipStatusBadge status={heroDisplayStatus} />
              </View>
              <Text style={[styles.heroClosure, heroDisplay.emphasis && styles.heroClosureEmphasis]}>{heroDisplay.primaryLabel}</Text>
              {heroDisplay.editable ? (
                <Text style={styles.heroProgress}>
                  {buildSelectionProgressLabel(currentTip.data?.selections?.length ?? 0)}
                </Text>
              ) : null}
              <View style={[styles.heroButton, !heroDisplay.editable && styles.heroButtonSecondary]}>
                <Text style={[styles.heroButtonText, !heroDisplay.editable && styles.heroButtonTextSecondary]}>{heroDisplay.ctaLabel}</Text>
              </View>
            </InfoCard>
          ) : (
            <EmptyState
              title="No active stage right now"
              message="There's nothing to tip at the moment — check back closer to the next stage."
            />
          )}

          {hero ? (
            <LockCountdownCard
              isFinal={hero.isFinal}
              locksAt={hero.stage.locks_at}
              manualLockedAt={hero.stage.manual_locked_at}
              startsAt={hero.stage.starts_at}
            />
          ) : null}

          {/* Position 3: latest completed stage */}
          <InfoCard
            accessibilityHint={latestResultLink?.accessibilityHint}
            accessibilityLabel={latestResultLink?.accessibilityLabel}
            href={latestResultLink?.href}
            meta={latestStage ? `Stage ${latestStage.stage_number}` : "No result yet"}
            title="Latest result"
          >
            {latestStage && latestResult ? (
              <>
                <View style={styles.resultTopRow}>
                  <StageTypeBadge stageType={latestStage.stage_type} />
                  <StageStatusBadge label="Completed" tone="completed" />
                </View>
                <Text style={styles.resultLabel}>{getStageTipExperience(latestStage.stage_type).isTtt ? "Winning team" : "Stage winner"}</Text>
                <Text style={styles.resultWinner}>{getStageWinnerName(latestResult) ?? "Pending"}</Text>
                <Text style={styles.resultPoints}>{latestTip.data?.score ? `You scored ${latestTip.data.score.total_score} points` : "Your score is pending"}</Text>
              </>
            ) : (
              <Text style={styles.copy}>No official stage results are available yet.</Text>
            )}
          </InfoCard>

          {/* Position 4: user competition summary */}
          {leaderboard.loading ? (
            <SkeletonStatGrid />
          ) : (
            <View style={styles.statGrid}>
              <DashboardStatCard
                accessibilityHint={rankLink.accessibilityHint}
                accessibilityLabel={me ? `Your position: rank ${me.rank}` : rankLink.accessibilityLabel}
                helper={me ? `${me.total_score} points` : "Appears after scoring"}
                href={rankLink.href}
                label="My position"
                value={me ? `#${me.rank}` : "—"}
              />
              <DashboardStatCard
                accessibilityHint={rankLink.accessibilityHint}
                accessibilityLabel="Points behind the leader"
                helper="points"
                href={rankLink.href}
                label="Behind leader"
                value={me && leader ? `${Math.max(0, leader.total_score - me.total_score)}` : "—"}
              />
              <DashboardStatCard
                accessibilityHint={historyLink.accessibilityHint}
                accessibilityLabel={historyLink.accessibilityLabel}
                helper="points scored"
                href={historyLink.href}
                label="Last stage"
                value={latestTip.data?.score ? `+${latestTip.data.score.total_score}` : "—"}
              />
            </View>
          )}

          <InfoCard title="Current jersey holders" meta={latestStage ? `After stage ${latestStage.stage_number}` : "Awaiting results"}>
            <View style={styles.jerseyGrid}>
              {jerseyOrder.map((jersey) => {
                const rider = latestResult?.jerseyResults.find((entry) => entry.jersey_type === jersey)?.rider;
                const jerseyLink = buildJerseyDashboardCardLink(jersey === "kom" ? "Polka Dot" : jersey.charAt(0).toUpperCase() + jersey.slice(1));
                return (
                  <JerseyHolderCard
                    accessibilityHint={jerseyLink.accessibilityHint}
                    href={jerseyLink.href}
                    jersey={jersey}
                    key={jersey}
                    riderName={rider?.display_name}
                    teamName={rider?.team?.name}
                  />
                );
              })}
            </View>
          </InfoCard>

          <InfoCard
            accessibilityHint={leaderboardLink.accessibilityHint}
            accessibilityLabel={leaderboardLink.accessibilityLabel}
            href={leaderboardLink.href}
            meta={competition.data?.name ?? "Overall"}
            title="Mini leaderboard"
          >
            {leaderboard.loading ? null : leaderboard.data?.slice(0, 5).map((row) => {
              const currentUser = row.user_id === user?.id;
              return (
                <View key={row.id} style={[styles.leaderRow, currentUser && styles.currentUserRow]}>
                  <View style={styles.rankBubble}><Text style={styles.rankText}>{row.rank}</Text></View>
                  <View style={styles.leaderCopy}>
                    <Text style={styles.leaderName}>{row.display_name}{currentUser ? " (You)" : ""}</Text>
                    <Text style={styles.leaderMeta}>{row.stages_tipped} stages tipped</Text>
                  </View>
                  <Text style={styles.leaderPoints}>{row.total_score}</Text>
                </View>
              );
            })}
            {!leaderboard.loading && !leaderboard.error && !leaderboard.data?.length ? (
              <Text style={styles.copy}>Leaderboard appears after the first scoring run.</Text>
            ) : null}
          </InfoCard>

          {/* Position 5: upcoming stages */}
          <InfoCard title="Upcoming stages" meta="Next on the road">
            {upcomingStages.length === 0 ? (
              <Text style={styles.copy}>No further stages are scheduled right now.</Text>
            ) : (
              upcomingStages.map(({ stage: candidate }) => (
                <Pressable
                  accessibilityHint="Double tap to view this stage"
                  accessibilityLabel={`Stage ${candidate.stage_number}, ${candidate.start_location ?? "TBC"} to ${candidate.finish_location ?? "TBC"}, ${formatShortDate(candidate.starts_at)}`}
                  accessibilityRole="button"
                  key={candidate.id}
                  onPress={() => router.push(`/stages/${candidate.id}`)}
                  style={({ pressed }) => [styles.upcomingRow, pressed && styles.rowPressed]}
                >
                  <View style={styles.stageNumber}><Text style={styles.stageNumberText}>{candidate.stage_number}</Text></View>
                  <View style={styles.leaderCopy}>
                    <Text style={styles.leaderName}>{candidate.start_location ?? "TBC"} → {candidate.finish_location ?? "TBC"}</Text>
                    <Text style={styles.leaderMeta}>{formatShortDate(candidate.starts_at)}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ))
            )}
          </InfoCard>

          {/* Position 6: recent results */}
          <InfoCard
            accessibilityHint="Double tap to view all stage results"
            accessibilityLabel="Recent results"
            href="/results"
            meta="Recently finished"
            title="Recent results"
          >
            {recentResults.length === 0 ? (
              <Text style={styles.copy}>No other stage results are available yet.</Text>
            ) : (
              recentResults.map(({ stage: pastStage, result: pastResult }) => (
                <View key={pastStage.id} style={styles.recentResultRow}>
                  <View style={styles.stageNumber}><Text style={styles.stageNumberText}>{pastStage.stage_number}</Text></View>
                  <View style={styles.leaderCopy}>
                    <Text style={styles.leaderName}>{getStageWinnerName(pastResult) ?? "Pending"}</Text>
                    <Text style={styles.leaderMeta}>{formatShortDate(pastStage.starts_at)}</Text>
                  </View>
                </View>
              ))
            )}
          </InfoCard>
        </>
      ) : null}

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
  heroButtonSecondary: { backgroundColor: "rgba(255,255,255,0.14)" },
  heroButtonText: { color: ui.colors.primary, fontSize: 16, fontWeight: "900" },
  heroButtonTextSecondary: { color: "#FFFFFF" },
  heroClosure: { color: "#E7F1EA", fontSize: 14, fontWeight: "800" },
  heroClosureEmphasis: { color: "#FFD9D6" },
  heroDistance: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  heroProgress: { color: "#C9E3D3", fontSize: 12, fontWeight: "700" },
  heroStatusRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  heroTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  jerseyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  leaderCopy: { flex: 1 },
  leaderMeta: { color: ui.colors.muted, fontSize: 12, marginTop: 2 },
  leaderName: { color: ui.colors.ink, fontSize: 14, fontWeight: "900" },
  leaderPoints: { color: ui.colors.primary, fontSize: 18, fontWeight: "900" },
  leaderRow: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 48 },
  rankBubble: { alignItems: "center", backgroundColor: ui.colors.primarySoft, borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  rankText: { color: ui.colors.primary, fontWeight: "900" },
  recentResultRow: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 48 },
  resultLabel: { color: ui.colors.muted, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  resultPoints: { color: ui.colors.success, fontSize: 13, fontWeight: "800" },
  resultTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  resultWinner: { color: ui.colors.primary, fontSize: 22, fontWeight: "900" },
  rowPressed: { opacity: 0.7 },
  stageNumber: { alignItems: "center", backgroundColor: ui.colors.primary, borderRadius: 12, height: 40, justifyContent: "center", width: 40 },
  stageNumberText: { color: "#FFFFFF", fontWeight: "900" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tttBanner: { alignSelf: "flex-start", backgroundColor: ui.colors.tttSoft, borderRadius: ui.radius.pill, paddingHorizontal: 11, paddingVertical: 7 },
  tttText: { color: ui.colors.ttt, fontSize: 12, fontWeight: "900" },
  upcomingRow: { alignItems: "center", borderBottomColor: ui.colors.border, borderBottomWidth: 1, flexDirection: "row", gap: 10, minHeight: 58 }
});
