import type { AppConfig } from "@tipping-suite/shared-types";

export const f1TipsConfig: AppConfig = {
  appKey: "f1tips",
  appName: "F1Tips",
  sportType: "motorsport",
  defaultCompetitionKey: "formula_1",
  theme: {
    primaryColor: "#E10600",
    secondaryColor: "#111111",
    backgroundColor: "#FFFFFF"
  },
  features: {
    ads: true,
    subscriptions: true,
    chat: true,
    dummyActivity: true,
    prizes: false
  },
  marketTypes: [
    "race_winner",
    "podium",
    "fastest_lap",
    "qualifying_winner"
  ]
};
