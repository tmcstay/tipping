export function getMissingTipFields(
  topFive: (string | null)[],
  _jerseys: Record<string, never> | undefined,
  isTtt: boolean
) {
  return topFive.flatMap((item, index) => item
    ? []
    : [`Select your ${ordinal(index + 1)} ${isTtt ? "team" : "place rider"}.`]);
}

function ordinal(value: number) {
  if (value === 1) return "1st";
  if (value === 2) return "2nd";
  if (value === 3) return "3rd";
  return `${value}th`;
}
