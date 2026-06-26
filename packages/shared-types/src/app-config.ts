export type SportType = "motorsport" | "cycling" | string;

export type MarketType =
  | "race_winner"
  | "podium"
  | "fastest_lap"
  | "qualifying_winner"
  | string;

export type AppConfig = {
  appKey: string;
  appName: string;
  sportType: SportType;
  defaultCompetitionKey: string;
  theme: {
    primaryColor: string;
    secondaryColor: string;
    backgroundColor: string;
  };
  features: {
    ads: boolean;
    subscriptions: boolean;
    chat: boolean;
    dummyActivity: boolean;
    prizes: boolean;
  };
  marketTypes: MarketType[];
};
