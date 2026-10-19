import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { BrowserConnection } from "../../apps/server/src/browser-ssh.js";

afterEach(() => vi.useRealTimers());
async function setup() {
  const messages: any[] = [];
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    send(data: string) {
      const message = JSON.parse(data);
      messages.push(message);
      if (message.type === "browser-request" && message.op === "open")
        conn.receive({
          type: "browser-result",
          id: message.id,
          result: { proof: {} },
        });
    },
    close: vi.fn(),
  });
  const authority = { unbind: vi.fn() };
  const conn = new BrowserConnection(
    "student",
    "sandbox",
    {} as any,
    authority as any,
    socket as any,
  );
  conn.alive = true;
  const command = vi
    .spyOn(conn, "command")
    .mockResolvedValue({ token: "admission" });
  // Admission signatures/scoping are covered by browser-ssh.test.ts. Here use
  // real BrowserPane objects and the real request/pending/timer lifecycle.
  vi.spyOn(conn as any, "receipt").mockReturnValue({
    result: { attempt: "attempt", pane: "pane" },
  });
  const pane = await conn.open("attempt", "pane");
  return { conn, pane, command, socket, messages };
}
it("pausing/ending a connection with panes never leaves a delayed unhandled close request", async () => {
  vi.useFakeTimers();
  const { conn, pane, messages, command } = await setup();
  const closed = vi.fn();
  pane.on("close", closed);
  const pending = (conn as any).request("command", {});
  const rejected = expect(pending).rejects.toThrow("SSH connection ended");
  conn.close();
  conn.close();
  await rejected;
  await pane.close();
  expect(command).toHaveBeenCalledTimes(1); // admission only
  expect(
    messages.filter((m) => m.type === "browser-request").map((m) => m.op),
  ).toEqual(["open", "command"]);
  expect(
    messages.filter((m) => m.type === "browser-notify").map((m) => m.op),
  ).toEqual(["close"]);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(conn.panes.size).toBe(0);
  expect((conn as any).pending.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(120001); // original production crash delay
  await expect((conn as any).request("close-pane", {})).rejects.toThrow(
    "unavailable",
  );
  expect(vi.getTimerCount()).toBe(0);
});
it("an explicit pane close failure cleans local state and reports the error to its caller", async () => {
  const { conn, pane, command } = await setup();
  const closed = vi.fn();
  pane.on("close", closed);
  command.mockRejectedValueOnce(Error("close failed"));
  await expect(pane.close()).rejects.toThrow("close failed");
  expect(conn.panes.size).toBe(0);
  expect(closed).toHaveBeenCalledTimes(1);
  await pane.close();
  expect(closed).toHaveBeenCalledTimes(1);
  conn.close();
});
it("connection loss while a pane close is in flight rejects its caller without recreating requests", async () => {
  vi.useFakeTimers();
  const { conn, pane, command } = await setup();
  command.mockImplementation(() => (conn as any).request("command", {}));
  const closing = pane.close();
  const rejected = expect(closing).rejects.toThrow("SSH connection ended");
  conn.close();
  await rejected;
  expect((conn as any).pending.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(120001);
});
