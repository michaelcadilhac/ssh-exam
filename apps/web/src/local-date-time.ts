export const deviceTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

export type DateTimePrecision = "minute" | "exact";

export function localDateTime(
  at: number,
  precision: DateTimePrecision = "minute",
) {
  if (!Number.isFinite(at) || at <= 0 || at >= 8640000000000000) return "";
  const date = new Date(at);
  return new Date(at - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, precision === "exact" ? 23 : 16);
}

export function localTimeOptions(
  value: string,
  precision: DateTimePrecision = "minute",
) {
  const format =
    precision === "exact"
      ? /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/
      : /^\d{4}-\d\d-\d\dT\d\d:\d\d$/;
  if (!format.test(value)) throw Error("Choose a date and time.");
  const at = new Date(value).getTime();
  if (
    !Number.isSafeInteger(at) ||
    localDateTime(at, precision).slice(0, value.length) !== value
  )
    throw Error(
      "That time is not valid in your timezone. Choose another time.",
    );
  const offset = new Date(at).getTimezoneOffset();
  const offsets = new Set(
    [-2, -1, 0, 1, 2].map((day) =>
      new Date(at + day * 86400000).getTimezoneOffset(),
    ),
  );
  return [
    ...new Set([...offsets].map((other) => at + (other - offset) * 60000)),
  ]
    .filter(
      (candidate) =>
        localDateTime(candidate, precision).slice(0, value.length) === value,
    )
    .sort((a, b) => a - b);
}
export function parseLocalDateTime(
  value: string,
  occurrence = 0,
  precision: DateTimePrecision = "minute",
) {
  const choices = localTimeOptions(value, precision);
  if (!Number.isInteger(occurrence) || !choices[occurrence])
    throw Error("Choose which occurrence of this time to use.");
  return choices[occurrence];
}
export function localOccurrence(
  at: number,
  precision: DateTimePrecision = "minute",
) {
  try {
    return Math.max(
      0,
      localTimeOptions(localDateTime(at, precision), precision).findIndex(
        (candidate) =>
          new Date(candidate).getTimezoneOffset() ===
          new Date(at).getTimezoneOffset(),
      ),
    );
  } catch {
    return 0;
  }
}

export const utcOffset = (at: number) => {
  const offset = -new Date(at).getTimezoneOffset();
  return `UTC${offset < 0 ? "−" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
};
export function windowLabel(start: number, end: number) {
  const offset =
    new Date(start).getTimezoneOffset() !== new Date(end).getTimezoneOffset() ||
    localTimeOptions(localDateTime(start)).length > 1 ||
    localTimeOptions(localDateTime(end)).length > 1;
  return `${shortDateTime(start)}${offset ? ` (${utcOffset(start)})` : ""} — ${shortDateTime(end)}${offset ? ` (${utcOffset(end)})` : ""}`;
}

export function shortDateTime(at: number) {
  const date = new Date(at);
  if (!Number.isFinite(at) || at <= 0 || !Number.isFinite(date.getTime()))
    return "Not set";
  return new Intl.DateTimeFormat(undefined, {
    ...(date.getFullYear() !== new Date().getFullYear()
      ? { year: "numeric" as const }
      : {}),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function timeLimit(seconds: number) {
  const minutes = Math.floor(seconds / 60),
    rest = seconds % 60;
  return `${minutes} min${rest ? ` ${rest} sec` : ""}`;
}
