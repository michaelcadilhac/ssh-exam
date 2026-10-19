import { AgentCommandDisconnectedError } from "./agent.js";

// Cancellation never needs password/MFA text or terminal output. Preserve known
// operational failures verbatim; never dump arbitrary SSH error text or stacks.
export function cleanupDiagnostic(error: unknown) {
  const text = error instanceof Error ? error.message : "";
  const disconnected = error instanceof AgentCommandDisconnectedError;
  const safe =
    [
      "SSH connection ended",
      "SSH transports unavailable",
      "SSH connection ended during admission",
      "Browser SSH control connection unavailable",
      "Browser SSH request could not be sent",
      "Reconnect student SSH before this operation; deadlines are enforced locally",
      "Attempt connection ended. Reconnect SSH to resume.",
      "cannot cancel started attempt",
      "attempt owner mismatch",
      "attempt SSH transport mismatch",
      "unknown attempt",
      "Attempt not found",
      "invalid recorded workload unit",
      "protected archive exists, but workload termination unconfirmed",
      "SSH command ended without acknowledgment",
      "SSH agent command timed out; await status callback",
      "Preflight cancellation was not confirmed by the class server",
    ].includes(text) ||
    /^Browser SSH operation timed out: (command|close-pane)$/.test(text) ||
    /^exit status [0-9]{1,3}$/.test(text);
  return {
    cause: disconnected
      ? "ssh-disconnected"
      : /timed out/.test(text)
        ? "command-timeout"
        : "command-failed",
    reason: safe
      ? text
      : disconnected
        ? "Student SSH command connection ended"
        : "Unexpected cleanup failure; untrusted error text omitted",
    errorType:
      error instanceof Error &&
      [
        "Error",
        "AgentCommandDisconnectedError",
        "TypeError",
        "RangeError",
        "AbortError",
      ].includes(error.name)
        ? error.name
        : "Error",
  };
}
