import type { MarketType } from "./app-config";

export type Tip = {
  id: string;
  userId: string;
  marketId: string;
  competitorId: string;
  submittedAt: string;
  isDummy: boolean;
};

export type Market = {
  id: string;
  eventId: string;
  marketKey: string;
  marketType: MarketType;
  name: string;
  lockAt: string;
  status: "open" | "locked" | "settled" | string;
};
