export function formatDateTime(value: string | null) {
  if (!value) {
    return "Time TBC";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
