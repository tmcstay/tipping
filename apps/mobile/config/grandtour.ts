import type { AppConfig } from "@tipping-suite/shared-types";

export const grandTourConfig: AppConfig = {
  appKey: "cycling",
  appName: "GrandTour Tips",
  sportType: "cycling",
  defaultCompetitionKey: "grandtour_france_2026",
  theme: {
    primaryColor: "#0E5C42",
    secondaryColor: "#0E5C42",
    backgroundColor: "#F6F7F6"
  },
  features: {
    ads: false,
    subscriptions: false,
    chat: false,
    dummyActivity: false,
    prizes: false
  },
  marketTypes: ["stage_winner"]
};
