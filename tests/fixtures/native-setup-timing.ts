// Private stress fixture only. Observe existing calls without changing their
// arguments, replies, refusals, authorization or timeout. Existing runner stderr
// supplies durable storage in direct mode; the separate gateway uses a bounded
// private JSONL sink. No process, socket or execution authority is added.
import type { IsolatedConnection } from "../../apps/server/src/connection-process.js";

type Connection = Pick<
  IsolatedConnection,
  "username" | "command" | "prepareMonitoring" | "secureAccess"
>;
const commandNames = new Set([
  "health",
  "inspect-attempt",
  "inspect-template",
  "prepare-workspace",
  "prepare-account-policy",
  "prepare-grant-attempt",
  "prepare-additional-grant-attempt",
  "prepare-practice-grant-attempt",
  "activate-grant-attempt",
  "activate-additional-grant-attempt",
  "activate-practice-grant-attempt",
  "activate-monitored-grant-attempt",
  "activate-monitored-additional-grant-attempt",
  "activate-monitored-practice-grant-attempt",
  "activate-attempt",
  "activate-versioned-attempt",
  "activate-recovery-attempt",
]);
export type SetupTiming = {
  at: number;
  username: string;
  connection: number;
  sequence: number;
  operation: string;
  event: "started" | "completed" | "failed";
  elapsed_ms?: number;
};
export function nativeSetupTimings(
  note: (row: SetupTiming) => void = (row) =>
    console.error("NATIVE_SETUP_OPERATION", JSON.stringify(row)),
) {
  let connectionSequence = 0,
    enabled = true;
  return (connection: Connection) => {
    const username = connection.username;
    if (
      !/^(?:examq(?:\d{2})?|setupbusy0[123])$/.test(username) ||
      ++connectionSequence > 256
    )
      return;
    const identity = connectionSequence;
    let operations = 0;
    const timed = async <T>(operation: string, call: () => Promise<T>) => {
      if (++operations > 128) return call();
      const sequence = operations,
        started = performance.now();
      const record = (event: SetupTiming["event"]) => {
        if (!enabled) return;
        try {
          note({
            at: Date.now(),
            username,
            connection: identity,
            sequence,
            operation,
            event,
            ...(event === "started"
              ? {}
              : { elapsed_ms: Math.round(performance.now() - started) }),
          });
        } catch {
          enabled = false;
        } // A diagnostic failure never changes the operation.
      };
      record("started");
      try {
        const result = await call();
        record("completed");
        return result;
      } catch (error) {
        record("failed");
        throw error;
      }
    };
    const command = connection.command.bind(connection);
    connection.command = (op, body) =>
      commandNames.has(op)
        ? timed(`command:${op}`, () => command(op, body))
        : command(op, body);
    const monitoring = connection.prepareMonitoring.bind(connection);
    connection.prepareMonitoring = () => timed("prepareMonitoring", monitoring);
    const secureAccess = connection.secureAccess.bind(connection);
    connection.secureAccess = (id, exam) =>
      timed("secureAccess", () => secureAccess(id, exam));
  };
}
