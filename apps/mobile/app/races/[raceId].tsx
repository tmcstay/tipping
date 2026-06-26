import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  getCurrentUser,
  getEventById,
  listCompetitorsForEvent,
  listCurrentUserTipsForMarkets,
  listMarketsForEvent,
  saveCurrentUserTip,
  type RaceCompetitor,
  type RaceMarket,
  type UserTip
} from "@tipping-suite/supabase-client";
import { canSubmitTip } from "@tipping-suite/tipping-core";

import { AppShell } from "../../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/DataState";
import { InfoCard } from "../../components/InfoCard";
import { useAsyncData } from "../../hooks/useAsyncData";
import { formatDateTime } from "../../lib/formatters";

export default function RaceDetailScreen() {
  const { raceId } = useLocalSearchParams<{ raceId: string }>();
  const eventId = Array.isArray(raceId) ? raceId[0] : raceId;
  const loadRace = useCallback(() => getEventById(eventId), [eventId]);
  const loadMarkets = useCallback(() => listMarketsForEvent(eventId), [eventId]);
  const loadCompetitors = useCallback(
    () => listCompetitorsForEvent(eventId),
    [eventId]
  );
  const loadUser = useCallback(() => getCurrentUser(), []);
  const raceState = useAsyncData(loadRace, [eventId]);
  const marketsState = useAsyncData(loadMarkets, [eventId]);
  const competitorsState = useAsyncData(loadCompetitors, [eventId]);
  const userState = useAsyncData(loadUser);
  const marketIds = useMemo(
    () => marketsState.data?.map((market) => market.id) ?? [],
    [marketsState.data]
  );
  const loadTips = useCallback(
    () => listCurrentUserTipsForMarkets(marketIds),
    [marketIds.join(",")]
  );
  const tipsState = useAsyncData(loadTips, [marketIds.join(",")]);
  const [savingMarketId, setSavingMarketId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const race = raceState.data;
  const tipsByMarketId = useMemo(() => {
    const entries = (tipsState.data ?? []).map(
      (tip) => [tip.market_id, tip] as const
    );

    return new Map<string, UserTip>(entries);
  }, [tipsState.data]);
  const competitorsById = useMemo(() => {
    const entries = (competitorsState.data ?? []).map(
      (competitor) => [competitor.id, competitor] as const
    );

    return new Map<string, RaceCompetitor>(entries);
  }, [competitorsState.data]);

  const handleSelectTip = async (market: RaceMarket, competitorId: string) => {
    if (!race) {
      return;
    }

    const allowed = canSubmitTip({
      event: { lockAt: race.lock_at },
      market: {
        lockAt: market.lock_at,
        status: market.status
      }
    });

    if (!allowed) {
      setSaveError("This market is locked. Tips can no longer be changed.");
      return;
    }

    setSavingMarketId(market.id);
    setSaveError(null);

    try {
      await saveCurrentUserTip({
        competitorId,
        marketId: market.id
      });
      tipsState.reload();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save tip.");
    } finally {
      setSavingMarketId(null);
    }
  };

  return (
    <AppShell
      title={race?.name ?? "Race Detail"}
      subtitle={race ? `${race.venue ?? "Venue TBC"} - ${race.country ?? ""}` : undefined}
    >
      {raceState.loading ? <LoadingState /> : null}
      {raceState.error ? (
        <ErrorState error={raceState.error} onRetry={raceState.reload} />
      ) : null}
      {!raceState.loading && !raceState.error && !race ? (
        <EmptyState message="This race could not be found." />
      ) : null}
      {race ? (
        <InfoCard title="Race timing" meta={race.status}>
          <Text style={styles.copy}>Starts {formatDateTime(race.starts_at)}</Text>
          <Text style={styles.lock}>Locks {formatDateTime(race.lock_at)}</Text>
        </InfoCard>
      ) : null}

      {marketsState.loading ? <LoadingState /> : null}
      {competitorsState.loading ? <LoadingState /> : null}
      {tipsState.loading ? <LoadingState /> : null}
      {marketsState.error ? (
        <ErrorState error={marketsState.error} onRetry={marketsState.reload} />
      ) : null}
      {competitorsState.error ? (
        <ErrorState
          error={competitorsState.error}
          onRetry={competitorsState.reload}
        />
      ) : null}
      {tipsState.error ? (
        <ErrorState error={tipsState.error} onRetry={tipsState.reload} />
      ) : null}
      {saveError ? <ErrorState error={saveError} /> : null}
      {!userState.loading && !userState.data ? (
        <InfoCard title="Sign in required" meta="Tips">
          <Text style={styles.copy}>
            Race markets are visible, but only authenticated users can submit or
            update tips.
          </Text>
        </InfoCard>
      ) : null}
      {!marketsState.loading &&
      !marketsState.error &&
      marketsState.data?.length === 0 ? (
        <EmptyState message="No markets are available for this race yet." />
      ) : null}
      {!marketsState.loading &&
        !marketsState.error &&
        marketsState.data?.map((market) => {
          const locked = race
            ? !canSubmitTip({
                event: { lockAt: race.lock_at },
                market: { lockAt: market.lock_at, status: market.status }
              })
            : true;
          const currentTip = tipsByMarketId.get(market.id);
          const selectedCompetitor = currentTip
            ? competitorsById.get(currentTip.competitor_id)
            : null;
          const disabled =
            locked || !userState.data || savingMarketId === market.id;

          return (
            <InfoCard
              title={market.name}
              meta={locked ? "Locked" : market.market_type}
              key={market.id}
            >
              <Text style={locked ? styles.lockedCopy : styles.copy}>
                {locked
                  ? "Tipping is locked for this market."
                  : `Locks ${formatDateTime(market.lock_at ?? race?.lock_at ?? null)}`}
              </Text>
              <Text style={styles.copy}>
                Current tip: {selectedCompetitor?.name ?? "No tip selected"}
              </Text>
              <View style={styles.competitorGrid}>
                {(competitorsState.data ?? []).map((competitor) => {
                  const selected = currentTip?.competitor_id === competitor.id;

                  return (
                    <Pressable
                      disabled={disabled}
                      key={`${market.id}-${competitor.id}`}
                      onPress={() => handleSelectTip(market, competitor.id)}
                      style={[
                        styles.competitorButton,
                        selected && styles.competitorButtonSelected,
                        disabled && styles.competitorButtonDisabled
                      ]}
                    >
                      <Text
                        style={[
                          styles.competitorName,
                          selected && styles.competitorNameSelected
                        ]}
                      >
                        {competitor.name}
                      </Text>
                      <Text
                        style={[
                          styles.competitorTeam,
                          selected && styles.competitorNameSelected
                        ]}
                      >
                        {competitor.team_name ?? "Independent"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </InfoCard>
          );
        })}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  competitorButton: {
    borderColor: "#DDDDDD",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: "48%",
    minHeight: 62,
    padding: 10
  },
  competitorButtonDisabled: {
    opacity: 0.55
  },
  competitorButtonSelected: {
    backgroundColor: "#111111",
    borderColor: "#111111"
  },
  competitorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8
  },
  competitorName: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "800"
  },
  competitorNameSelected: {
    color: "#FFFFFF"
  },
  competitorTeam: {
    color: "#666666",
    fontSize: 12,
    marginTop: 3
  },
  copy: {
    color: "#555555",
    fontSize: 15,
    lineHeight: 21
  },
  lock: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "700"
  },
  lockedCopy: {
    color: "#B00020",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21
  }
});
