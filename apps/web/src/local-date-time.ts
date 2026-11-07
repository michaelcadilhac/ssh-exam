export const deviceTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;
export const DEFAULT_EXAM_TIMEZONE = "America/Chicago";
export type DateTimePrecision = "minute" | "exact";
const formats = new Map<string, Intl.DateTimeFormat>();
function formatter(
  zone: string,
  kind: "parts" | "short" | "year" | "full" | "started",
) {
  const key = zone + ":" + kind;
  let result = formats.get(key);
  if (!result) {
    result = new Intl.DateTimeFormat(kind === "parts" ? "en-US" : undefined, {
      timeZone: zone,
      year: kind === "short" ? undefined : "numeric",
      month: kind === "parts" ? "2-digit" : "short",
      day: kind === "parts" ? "2-digit" : "numeric",
      hour: kind === "parts" ? "2-digit" : "numeric",
      minute: "2-digit",
      ...(kind === "parts"
        ? { second: "2-digit", hourCycle: "h23" as const }
        : {}),
      ...(["full", "started"].includes(kind)
        ? { timeZoneName: "short" as const }
        : {}),
      ...(kind === "full" ? { second: "2-digit" as const } : {}),
    });
    if (formats.size >= 64) formats.delete(formats.keys().next().value!);
    formats.set(key, result);
  }
  return result;
}
function parts(at: number, zone: string) {
  return Object.fromEntries(
    formatter(zone, "parts")
      .formatToParts(at)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
}
function offsetMinutes(at: number, zone: string) {
  const p = parts(at, zone);
  const wall = Date.parse(
    `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
  );
  return (wall - Math.floor(at / 1000) * 1000) / 60000;
}
export function localDateTime(
  at: number,
  precision: DateTimePrecision = "minute",
  zone = deviceTimeZone(),
) {
  if (!Number.isFinite(at) || at <= 0 || at >= 8640000000000000) return "";
  const p = parts(at, zone),
    value = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  return precision === "exact"
    ? `${value}:${p.second}.${String(new Date(at).getUTCMilliseconds()).padStart(3, "0")}`
    : value;
}
export function localTimeOptions(
  value: string,
  precision: DateTimePrecision = "minute",
  zone = deviceTimeZone(),
) {
  const pattern =
    precision === "exact"
      ? /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/
      : /^\d{4}-\d\d-\d\dT\d\d:\d\d$/;
  if (!pattern.test(value)) throw Error("Choose a date and time.");
  const wall = Date.parse(value + "Z");
  if (!Number.isSafeInteger(wall)) throw Error("Choose a valid date and time.");
  const offsets = new Set(
    [-2, -1, 0, 1, 2].map((day) => offsetMinutes(wall + day * 86400000, zone)),
  );
  const choices = [...offsets]
    .map((offset) => wall - offset * 60000)
    .filter(
      (at) =>
        localDateTime(at, precision, zone).slice(0, value.length) === value,
    )
    .sort((a, b) => a - b);
  if (!choices.length)
    throw Error(
      "That time is not valid in the exam time zone. Choose another time.",
    );
  return choices;
}
export function parseLocalDateTime(
  value: string,
  occurrence = 0,
  precision: DateTimePrecision = "minute",
  zone = deviceTimeZone(),
) {
  const choices = localTimeOptions(value, precision, zone);
  if (!Number.isInteger(occurrence) || !choices[occurrence])
    throw Error("Choose which occurrence of this time to use.");
  return choices[occurrence];
}
export function localOccurrence(
  at: number,
  precision: DateTimePrecision = "minute",
  zone = deviceTimeZone(),
) {
  try {
    return Math.max(
      0,
      localTimeOptions(
        localDateTime(at, precision, zone),
        precision,
        zone,
      ).findIndex(
        (candidate) =>
          offsetMinutes(candidate, zone) === offsetMinutes(at, zone),
      ),
    );
  } catch {
    return 0;
  }
}
export function utcOffset(at: number, zone = deviceTimeZone()) {
  const offset = offsetMinutes(at, zone);
  return `UTC${offset < 0 ? "−" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
}
export function shortDateTime(at: number, zone = deviceTimeZone()) {
  if (!Number.isFinite(at) || at <= 0 || at >= 8640000000000000)
    return "Not set";
  return formatter(
    zone,
    parts(at, zone).year === parts(Date.now(), zone).year ? "short" : "year",
  ).format(at);
}
export function dateTime(
  at: number | null | undefined,
  zone = DEFAULT_EXAM_TIMEZONE,
  seconds = true,
) {
  return at && Number.isFinite(at)
    ? formatter(zone, seconds ? "full" : "started").format(at)
    : "—";
}
export function windowLabel(
  start: number,
  end: number,
  zone = deviceTimeZone(),
) {
  const offset =
    offsetMinutes(start, zone) !== offsetMinutes(end, zone) ||
    localTimeOptions(localDateTime(start, "minute", zone), "minute", zone)
      .length > 1 ||
    localTimeOptions(localDateTime(end, "minute", zone), "minute", zone)
      .length > 1;
  return `${shortDateTime(start, zone)}${offset ? ` (${utcOffset(start, zone)})` : ""} — ${shortDateTime(end, zone)}${offset ? ` (${utcOffset(end, zone)})` : ""}`;
}
export function timeLimit(seconds: number) {
  const minutes = Math.floor(seconds / 60),
    rest = seconds % 60;
  return `${minutes} min${rest ? ` ${rest} sec` : ""}`;
}
