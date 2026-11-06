export const FOCUS_GRACE_MS = 60_000;
export const FOCUS_GRACE_REASON =
  "Browser focus did not return within 60 seconds";

export function focusGraceSeconds(lostAt: number | null, time: number) {
  return lostAt === null
    ? null
    : Math.max(0, Math.ceil((lostAt + FOCUS_GRACE_MS - time) / 1000));
}
