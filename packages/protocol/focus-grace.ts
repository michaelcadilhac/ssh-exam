export const INTERRUPTION_GRACE_MS = 15_000;
export const INTERRUPTION_GRACE_REASON =
  "Required exam conditions were not restored within 15 seconds";
// Retain the existing internal field/API names for stored grace observations.
export const FOCUS_GRACE_MS = INTERRUPTION_GRACE_MS;
export const FOCUS_GRACE_REASON = INTERRUPTION_GRACE_REASON;

export function examConditionsReady(
  ready: Record<string, unknown>,
  webcam: boolean,
  singleDisplay = false,
) {
  return (
    ["fullscreen", "visible", "keyboard", "screen", "focus"].every(
      (key) => ready[key] === true,
    ) &&
    (!webcam || ready.webcam === true) &&
    displayReadiness(ready, singleDisplay) === true
  );
}

export function examConditionsVerdict(
  ready: Record<string, unknown>,
  webcam: boolean,
  singleDisplay = false,
): boolean | null {
  if (!examConditionsReady(ready, webcam)) return false;
  return displayReadiness(ready, singleDisplay);
}

export function focusGraceSeconds(lostAt: number | null, time: number) {
  return lostAt === null
    ? null
    : Math.max(0, Math.ceil((lostAt + FOCUS_GRACE_MS - time) / 1000));
}
import { displayReadiness } from "./display-policy.js";
