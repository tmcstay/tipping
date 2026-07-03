export function formatDateTime(value: string | null) {
  if (!value) {
    return "Time TBC";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatShortDate(value: string | null) {
  if (!value) return "Date TBC";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(new Date(value));
}

export function formatTime(value: string | null) {
  if (!value) return "Time TBC";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatDurationUntil(value: string | null) {
  if (!value) return "Lock time TBC";
  const diffMs = new Date(value).getTime() - Date.now();
  if (Number.isNaN(diffMs)) return "Lock time TBC";
  if (diffMs <= 0) return "Locked";

  const totalMinutes = Math.ceil(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

export function formatStageType(value: string | null | undefined) {
  if (!value) return "Stage";
  return value
    .replaceAll("_", " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatOrdinal(value: number) {
  const suffix = value % 10 === 1 && value % 100 !== 11
    ? "st"
    : value % 10 === 2 && value % 100 !== 12
      ? "nd"
      : value % 10 === 3 && value % 100 !== 13
        ? "rd"
        : "th";
  return `${value}${suffix}`;
}

export function formatRiderDisplayName(displayName: string, bibNumber: number | null | undefined) {
  return bibNumber == null ? displayName : `#${bibNumber} ${displayName}`;
}

export function preferStageBibNumber(
  startlistBibNumber: number | null | undefined,
  riderBibNumber: number | null | undefined
) {
  return startlistBibNumber ?? riderBibNumber ?? null;
}
