import { OPERATION_TIMEOUT_MS } from "../../../packages/protocol/timeouts.js";
import type { AgentSession } from "./agent.js";

export const setupHealthBusyMessage =
  "The server is checking exam setup. Wait a moment, then try again.";

export function isNativeHealthBusy(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.message.startsWith(
      "native readiness verification already in progress;",
    )
  );
}

// Health is a read-only observation, never an admission/activation receipt. Each
// command gets a fresh authorization/nonce. Retry only its exact busy refusal,
// once; both observations and the short delay share the original time budget.
// A late read-only reply cannot continue the caller after the budget expires.
export async function observeSetupHealth(
  connection: Pick<AgentSession, "command">,
) {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observation = (async () => {
    try {
      return await connection.command("health");
    } catch (error) {
      if (!isNativeHealthBusy(error) || expired) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (expired) throw error;
      return connection.command("health");
    }
  })();
  try {
    return await Promise.race([
      observation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(Error("Exam setup observation exceeded its time limit"));
        }, OPERATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
