// Display only. Stored durations remain seconds and timestamps remain Unix milliseconds.
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  let left = Math.max(0, Math.floor(seconds));
  const parts: string[] = [];
  for (const [size, unit] of [
    [86400, "d"],
    [3600, "h"],
    [60, "min"],
    [1, "s"],
  ] as const) {
    const count = Math.floor(left / size);
    if (count) parts.push(`${count}${unit}`);
    left %= size;
  }
  return parts.join(" ") || "0s";
}

export function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const secs = String(total % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}`
    : `${minutes}:${secs}`;
}
