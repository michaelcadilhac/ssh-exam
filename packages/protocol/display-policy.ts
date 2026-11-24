import { z } from "zod";

export const displayObservation = z.enum(["single", "multiple", "unavailable"]);
export type DisplayObservation = z.infer<typeof displayObservation>;

// Unknown display topology is technical uncertainty, never a policy violation.
// Other positively observed condition losses still use their ordinary grace.
export function displayReadiness(
  ready: Record<string, unknown>,
  required: boolean,
): boolean | null {
  if (!required || ready.display === "single") return true;
  return ready.display === "multiple" ? false : null;
}

export function displayReadinessMessage(ready: unknown, required: boolean) {
  const value =
    ready && typeof ready === "object"
      ? (ready as Record<string, unknown>).display
      : undefined;
  if (!required || value === "single") return null;
  return value === "multiple"
    ? "Disconnect or disable extra displays."
    : "Verify that only one display is active before continuing. Allow display permission; if your browser cannot check displays, use desktop Chrome or Edge, or contact your instructor.";
}
