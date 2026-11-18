import { expect, it, vi } from "vitest";
import {
  nativeSetupTimings,
  type SetupTiming,
} from "../fixtures/native-setup-timing.js";
function setup(note?: (row: SetupTiming) => void) {
  const rows: SetupTiming[] = [],
    record = vi.fn(
      note ??
        ((row) => {
          rows.push(row);
        }),
    );
  const trace = nativeSetupTimings(record);
  const connection = {
    username: "examq",
    command: vi.fn(async function (this: any, _op: string, _body?: any) {
      expect(this.username).toBe("examq");
      return { private_reply: "never-record-this" };
    }),
    prepareMonitoring: vi.fn(async () => true),
    secureAccess: vi.fn(async (_id: string, _exam: string) => {}),
  };
  const command = connection.command;
  trace(connection);
  return { rows, record, trace, connection, command };
}
it("observes each call once, preserving binding and result without payloads", async () => {
  const f = setup();
  expect(
    await f.connection.command("health", { password: "do-not-record" }),
  ).toEqual({ private_reply: "never-record-this" });
  expect(f.command).toHaveBeenCalledExactlyOnceWith("health", {
    password: "do-not-record",
  });
  expect(await f.connection.prepareMonitoring()).toBe(true);
  await f.connection.secureAccess("private-attempt", "private-exam");
  expect(f.rows.map((r) => [r.operation, r.event])).toEqual([
    ["command:health", "started"],
    ["command:health", "completed"],
    ["prepareMonitoring", "started"],
    ["prepareMonitoring", "completed"],
    ["secureAccess", "started"],
    ["secureAccess", "completed"],
  ]);
  expect(JSON.stringify(f.rows)).not.toMatch(
    /password|do-not-record|never-record-this|private-attempt|private-exam/,
  );
});
it("preserves the exact refusal without logging its private message", async () => {
  const f = setup(),
    error = Error("private signed refusal with a secret");
  f.command.mockRejectedValueOnce(error);
  await expect(f.connection.command("health")).rejects.toBe(error);
  expect(f.command).toHaveBeenCalledTimes(1);
  expect(f.rows.map((r) => r.event)).toEqual(["started", "failed"]);
  expect(JSON.stringify(f.rows)).not.toContain("secret");
});
it("a failed diagnostic sink cannot change or replay the real operation", async () => {
  const f = setup(() => {
    throw Error("unavailable private log");
  });
  await f.connection.command("health");
  await f.connection.command("health");
  expect(f.command).toHaveBeenCalledTimes(2);
  expect(f.record).toHaveBeenCalledTimes(1);
});
it("bounds records, excludes renewals and ignores non-synthetic accounts", async () => {
  const f = setup();
  for (let i = 0; i < 140; i++) await f.connection.command("health");
  for (let i = 0; i < 10; i++)
    await f.connection.command("renew-execution-lease");
  expect(f.command).toHaveBeenCalledTimes(150);
  expect(f.rows).toHaveLength(256);
  expect(JSON.stringify(f.rows)).not.toContain("renew-execution");
  const other = {
    ...f.connection,
    username: "actual-account",
    command: vi.fn(async () => ({})),
  };
  f.trace(other);
  await other.command();
  expect(f.rows).toHaveLength(256);
});
