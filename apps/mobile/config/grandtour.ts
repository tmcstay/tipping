import type { AppConfig } from "@tipping-suite/shared-types";

export const grandTourConfig: AppConfig = {
  appKey: "cycling",
  appName: "GrandTour Tips",
  sportType: "cycling",
  defaultCompetitionKey: "grandtour_france_2026",
  theme: {
    primaryColor: "#425197",
    secondaryColor: "#425197",
    backgroundColor: "#F5F7FA"
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
