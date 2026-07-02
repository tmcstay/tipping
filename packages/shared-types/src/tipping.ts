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

export type GrandTourTipMode = "daily" | "preselection";
export type GrandTourTipScope = "stage" | "overall_jerseys";
export type GrandTourTipStatus =
  | "draft"
  | "submitted"
  | "locked"
  | "scored"
  | "voided"
  | "corrected"
  | "missed"
  | "deleted";

export type GrandTourSelectionType =
  | "stage_top_5"
  | "yellow_holder"
  | "green_holder"
  | "kom_holder"
  | "white_holder"
  | "overall_yellow_winner"
  | "overall_green_winner"
  | "overall_kom_winner"
  | "overall_white_winner";

export type GrandTourTipSelectionInput = {
  selection_type: GrandTourSelectionType;
  rider_id: string;
  predicted_position?: number | null;
};
