export function getMissingTipFields(
  topFive: (string | null)[],
  _jerseys: Record<string, never> | undefined,
  isTtt: boolean
) {
  return topFive.flatMap((item, index) => item
    ? []
    : [`Select your ${ordinal(index + 1)} ${isTtt ? "team" : "place rider"}.`]);
}

/**
 * One concise line for the review card - replaces a per-row "Missing" list
 * with a single count-based message, and a distinct "all done" message once
 * every slot is filled.
 */
export function buildTopFiveValidationMessage(topFive: (string | null)[], isTtt: boolean): string {
  const missingCount = topFive.filter((item) => !item).length;
  if (missingCount === 0) {
    return "Your top five is complete. Review the order, then submit.";
  }
  const noun = isTtt ? "team" : "rider";
  return `Select ${missingCount} more ${noun}${missingCount === 1 ? "" : "s"} before submitting.`;
}

function ordinal(value: number) {
  if (value === 1) return "1st";
  if (value === 2) return "2nd";
  if (value === 3) return "3rd";
  return `${value}th`;
}
