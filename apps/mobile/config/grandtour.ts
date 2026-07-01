import type { AppConfig } from "@tipping-suite/shared-types";

export const grandTourConfig: AppConfig = {
  appKey: "cycling",
  appName: "GrandTour Tips",
  sportType: "cycling",
  defaultCompetitionKey: "grandtour_france_2026",
  theme: {
    primaryColor: "#F4C430",
    secondaryColor: "#12372A",
    backgroundColor: "#FFFFFF"
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
