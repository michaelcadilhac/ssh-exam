export const PREFLIGHT_TIMEOUT_MINUTES = 15;
export const PREFLIGHT_TIMEOUT_MS = PREFLIGHT_TIMEOUT_MINUTES * 60 * 1000;
export const PREFLIGHT_EXPIRED_REASON = `Preflight expired after ${PREFLIGHT_TIMEOUT_MINUTES} minutes. Sign out and sign in again; your exam has not started.`;

export function preflightExpired(
  attempt: {
    state: string;
    start?: number | null;
    preflight_started_at?: number | null;
  },
  at: number,
) {
  return (
    attempt.state === "PREPARING" &&
    !attempt.start &&
    !!attempt.preflight_started_at &&
    at >= attempt.preflight_started_at + PREFLIGHT_TIMEOUT_MS
  );
}
