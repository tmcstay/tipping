export type TipEntryJerseyKey = "yellow" | "green" | "kom" | "white";

const jerseyLabels: Record<TipEntryJerseyKey, string> = {
  yellow: "Yellow Jersey rider",
  green: "Green Jersey rider",
  kom: "Polka Dot Jersey rider",
  white: "White Jersey rider"
};

export function getMissingTipFields(
  topFive: (string | null)[],
  jerseys: Partial<Record<TipEntryJerseyKey, string>>,
  isTtt: boolean
) {
  const missing = topFive.flatMap((item, index) => item
    ? []
    : [`Select your ${ordinal(index + 1)} ${isTtt ? "team" : "place rider"}.`]);
  for (const jersey of Object.keys(jerseyLabels) as TipEntryJerseyKey[]) {
    if (!jerseys[jersey]) missing.push(`Select your ${jerseyLabels[jersey]}.`);
  }
  return missing;
}

function ordinal(value: number) {
  if (value === 1) return "1st";
  if (value === 2) return "2nd";
  if (value === 3) return "3rd";
  return `${value}th`;
}
