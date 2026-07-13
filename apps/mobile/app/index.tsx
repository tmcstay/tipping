import { resolveCyclingStageClosureState, selectLatestEligibleStage } from "@tipping-suite/tipping-core";
import { Link, Redirect } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CyclingStage, CyclingStageResult } from "@tipping-suite/supabase-client";

import { useAuth } from "../auth/useAuth";
import { AppShell } from "../components/AppShell";
import { EmptyState, ErrorState, SkeletonCard } from "../components/DataState";
import { InfoCard } from "../components/InfoCard";
import { JerseyHolderCard, type JerseyKind } from "../components/JerseyHolderCard";
import { StageStatusBadge } from "../components/StageStatusBadge";
import { ui } from "../components/theme";
import {
  useCyclingCompetition,
  useCyclingLeaderboard,
  useCyclingStageResults,
  useTdf2026Stages
} from "../hooks/useCyclingData";
import { useStageTipDraft } from "../hooks/useGrandTourTips";
import { formatDateTime } from "../lib/formatters";
import { getStageTipExperience } from "../lib/stageExperience";
import {
  buildClosureDisplay,
  buildJerseyDashboardCardLink,
  buildLeaderboardDashboardCardLink,
  buildRankStatCardLink,
  buildSelectionProgressLabel,
  buildStageDashboardCardLink
} from "../lib/stageClosureExperience";

const jerseyOrder: JerseyKind[] = ["yellow", "green", "kom", "white"];

function getStageWinnerName(result: CyclingStageResult | null | undefined): string | null {
  if (!result) return null;
  return (
    result.teamResults.find((line) => line.actual_position === 1)?.team.name
    ?? result.riderResults.find((line) => line.actual_position === 1)?.rider.display_name
    ?? null
  );
}

function firstName(displayName: string | null | undefined): string {
  if (!displayName) return "there";
  return displayName.trim().split(/\s+/)[0] ?? "there";
}

type StageClosure = {
  stage: CyclingStage;
  result: CyclingStageResult | null;
  isFinal: boolean;
  closureState: ReturnType<typeof resolveCyclingStageClosureState>;
};

/**
 * "/" is owned by exactly one screen (this one), registered
 * unconditionally in app/_layout.tsx - never inside a Stack.Protected
 * group. See the git history for why (a duplicate "/" registration
 * between this screen and the now-removed app/(auth)/index.tsx produced a
 * real production navigation loop).
 */
export default function HomeScreen() {
  const { isPasswordRecovery, user } = useAuth();
  if (!user || isPasswordRecovery) {
    return <Redirect href="/login" />;
  }
  return <AuthenticatedDashboard />;
}

/**
 * Visual redesign (functionally unchanged from the previous dashboard -
 * same data, same navigation targets, same closure/eligibility logic):
 * user-centric hierarchy over event-centric. Every screen answers "how am
 * I doing" (a plain-text rank/points header, no card chrome) and "what
 * should I do next" (one action card) BEFORE any race/stage information,
 * which is now compact secondary content rather than a stack of
 * full-width cards. One accent colour throughout; card count on this
 * screen dropped from 8 to 3.
 */
function AuthenticatedDashboard() {
  const { profile, user } = useAuth();
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

  // The stage that most needs the user's attention: the soonest stage
  // still open (or closing soon) for tipping, or (if none are open) a
  // stage that's actually live right now.
  const actionCandidates = stagesWithClosure
    .filter((entry) => entry.closureState === "open" || entry.closureState === "closing_soon")
    .sort((a, b) => new Date(a.stage.starts_at).getTime() - new Date(b.stage.starts_at).getTime());
  const liveCandidates = stagesWithClosure.filter((entry) => entry.closureState === "live");
  const hero = actionCandidates[0] ?? liveCandidates[0] ?? null;

  // The latest result-eligible stage, via the shared, deterministic
  // tipping-core selector - never a future stage, never a stage row
  // treated as a result merely because it exists.
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

  return (
    <AppShell title={`Hi ${firstName(profile?.display_name)}`}>
      {initialLoading ? (
        <>
          <SkeletonCard lines={1} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={5} />
        </>
      ) : null}

      {initialError ? <ErrorState error={initialError} onRetry={() => { race.reload(); stages.reload(); }} /> : null}

      {!initialLoading && !initialError ? (
        <>
          {/* "How am I doing?" - plain text, no card chrome. */}
          <Link asChild href={rankLink.href}>
            <Pressable
              accessibilityHint={rankLink.accessibilityHint}
              accessibilityLabel={me ? `Your position: rank ${me.rank} of ${leaderboard.data?.length ?? 0}, ${me.total_score} points` : "Your position, not yet scored"}
              accessibilityRole="button"
              style={({ pressed }) => [styles.statusHeader, pressed && styles.statusHeaderPressed]}
            >
              <View style={styles.statusRow}>
                <View>
                  <Text style={styles.statusValue}>{me ? `#${me.rank}` : "-"}</Text>
                  <Text style={styles.statusLabel}>Your rank</Text>
                </View>
                <View style={styles.statusDivider} />
                <View>
                  <Text style={styles.statusValue}>{me ? me.total_score : "-"}</Text>
                  <Text style={styles.statusLabel}>Points</Text>
                </View>
              </View>
            </Pressable>
          </Link>

          {/* "What should I do next?" - the one action card. */}
          {hero && heroDisplay && heroExperience && heroLink ? (
            <InfoCard
              accent
              accessibilityHint={heroLink.accessibilityHint}
              accessibilityLabel={heroLink.accessibilityLabel}
              href={heroLink.href}
              meta={`Stage ${hero.stage.stage_number}${heroExperience.isTtt ? " · Team time trial" : ""}`}
              title={`${hero.stage.start_location ?? "TBC"} → ${hero.stage.finish_location ?? "TBC"}`}
            >
              <View style={styles.heroStatusRow}>
                <StageStatusBadge emphasis={heroDisplay.emphasis} label={heroDisplay.badgeLabel} tone={hero.closureState} />
                <Text style={[styles.heroClosure, heroDisplay.emphasis && styles.heroClosureEmphasis]}>{heroDisplay.primaryLabel}</Text>
              </View>
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
              title="Nothing to do right now"
              message="You're all caught up - check back closer to the next stage."
            />
          )}

          {/* Secondary: competition context, compact. A plain container -
              each row below is its own independent link (never nested
              inside another Pressable/Link), since they navigate to
              genuinely different destinations. */}
          <InfoCard meta={competition.data?.name ?? "Overall"} title="Competition">
            {latestStage && latestResult && latestResultLink ? (
              <Link asChild href={latestResultLink.href}>
                <Pressable
                  accessibilityHint={latestResultLink.accessibilityHint}
                  accessibilityLabel={latestResultLink.accessibilityLabel}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.summaryRow, pressed && styles.raceLinkRowPressed]}
                >
                  <View style={styles.summaryRowInner}>
                    <View style={styles.summaryTextColumn}>
                      <Text style={styles.summaryLabel}>Stage {latestStage.stage_number} result</Text>
                      <Text style={styles.summaryValue}>{getStageWinnerName(latestResult) ?? "Pending"}</Text>
                    </View>
                    <Text style={styles.summaryMeta}>
                      {latestTip.data?.score ? `+${latestTip.data.score.total_score} pts` : "Pending"}
                    </Text>
                  </View>
                </Pressable>
              </Link>
            ) : null}

            <View style={styles.jerseyList}>
              {jerseyOrder.map((jersey) => {
                const rider = latestResult?.jerseyResults.find((entry) => entry.jersey_type === jersey)?.rider;
                const jerseyLink = buildJerseyDashboardCardLink(jersey === "kom" ? "Polka dot" : jersey.charAt(0).toUpperCase() + jersey.slice(1));
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

            {leaderboard.data?.length ? (
              <Link asChild href={leaderboardLink.href}>
                <Pressable
                  accessibilityHint={leaderboardLink.accessibilityHint}
                  accessibilityLabel={leaderboardLink.accessibilityLabel}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.raceLinkRow, styles.summaryFooterRow, pressed && styles.raceLinkRowPressed]}
                >
                  <View style={styles.raceLinkRowInner}>
                    <Text style={styles.summaryFooter}>
                      {me ? `You're #${me.rank} of ${leaderboard.data.length}` : `${leader?.display_name ?? "Leader"} is #1 with ${leader?.total_score ?? 0} pts`}
                    </Text>
                    <Text style={styles.chevron}>›</Text>
                  </View>
                </Pressable>
              </Link>
            ) : null}
          </InfoCard>

          {/* Race information: secondary navigation, not the focus. */}
          <View style={styles.raceLinks}>
            <Link asChild href="/stages">
              <Pressable
                accessibilityHint="Double tap to view the stage schedule"
                accessibilityLabel="Race schedule"
                accessibilityRole="button"
                style={({ pressed }) => [styles.raceLinkRow, pressed && styles.raceLinkRowPressed]}
              >
                <View style={styles.raceLinkRowInner}>
                  <Text style={styles.raceLinkText}>Race schedule</Text>
                  <Text style={styles.chevron}>›</Text>
                </View>
              </Pressable>
            </Link>
            <Link asChild href="/results">
              <Pressable
                accessibilityHint="Double tap to view all stage results"
                accessibilityLabel="All results"
                accessibilityRole="button"
                style={({ pressed }) => [styles.raceLinkRow, pressed && styles.raceLinkRowPressed]}
              >
                <View style={styles.raceLinkRowInner}>
                  <Text style={styles.raceLinkText}>All results</Text>
                  <Text style={styles.chevron}>›</Text>
                </View>
              </Pressable>
            </Link>
          </View>
        </>
      ) : null}

      <Text style={styles.disclaimer}>GrandTour Tips is an independent cycling tipping app and is not affiliated with a race organiser.</Text>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  chevron: { color: ui.colors.faint, fontSize: 18, fontWeight: "600" },
  disclaimer: { color: ui.colors.faint, fontSize: 11, lineHeight: 16, textAlign: "center" },
  heroButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: ui.radius.medium, justifyContent: "center", minHeight: 48, marginTop: 6, paddingHorizontal: 16 },
  heroButtonSecondary: { backgroundColor: "rgba(255,255,255,0.14)" },
  heroButtonText: { color: ui.colors.primary, fontSize: 15, fontWeight: "700" },
  heroButtonTextSecondary: { color: "#FFFFFF" },
  heroClosure: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "600" },
  heroClosureEmphasis: { color: "#FFFFFF", fontWeight: "700" },
  heroProgress: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 6 },
  heroStatusRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  jerseyList: { gap: 2, marginTop: 4 },
  raceLinkRow: { justifyContent: "center", minHeight: 44, paddingHorizontal: 4 },
  raceLinkRowInner: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  raceLinkRowPressed: { opacity: 0.6 },
  raceLinkText: { color: ui.colors.ink, fontSize: 14, fontWeight: "500" },
  raceLinks: { gap: 0 },
  statusDivider: { backgroundColor: ui.colors.border, height: 32, width: 1 },
  statusHeader: { paddingHorizontal: 4, paddingVertical: 4 },
  statusHeaderPressed: { opacity: 0.7 },
  statusLabel: { color: ui.colors.muted, fontSize: 12, fontWeight: "500", marginTop: 2 },
  statusRow: { alignItems: "center", flexDirection: "row", gap: 24 },
  statusValue: { color: ui.colors.ink, fontSize: 34, fontWeight: "700", letterSpacing: -0.5 },
  summaryFooter: { color: ui.colors.muted, fontSize: 12 },
  summaryFooterRow: { marginTop: 8, minHeight: 32, paddingHorizontal: 0 },
  summaryLabel: { color: ui.colors.faint, fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  summaryMeta: { color: ui.colors.muted, fontSize: 13, fontWeight: "600" },
  summaryRow: { borderBottomColor: ui.colors.border, borderBottomWidth: 1, justifyContent: "center", minHeight: 44, paddingBottom: 10, marginBottom: 6 },
  summaryRowInner: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  summaryTextColumn: { flex: 1 },
  summaryValue: { color: ui.colors.ink, fontSize: 14, fontWeight: "600", marginTop: 2 }
});
