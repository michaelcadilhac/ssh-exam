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
it("concurrent terminal closes share one operation and leave other SSH state alive", async () => {
  const { conn, pane, command } = await setup();
  let done!: () => void;
  command.mockImplementationOnce(
    () => new Promise<void>((resolve) => (done = resolve)),
  );
  const detach = vi.spyOn(conn, "detachPane").mockResolvedValue();
  const a = pane.close(),
    b = pane.close();
  expect(a).toBe(b);
  done();
  await Promise.all([a, b]);
  expect(command).toHaveBeenCalledTimes(2); // admission + close
  expect(detach).toHaveBeenCalledTimes(1);
  expect(conn.alive).toBe(true);
  conn.close();
});
it("natural shell exit frees the server terminal slot without new cleanup requests", async () => {
  const { conn, pane, command } = await setup();
  const closed = vi.fn();
  pane.on("close", closed);
  conn.receive({ type: "browser-pane-closed", pane: "pane" });
  conn.receive({ type: "browser-pane-closed", pane: "pane" });
  expect(conn.panes.size).toBe(0);
  expect(closed).toHaveBeenCalledTimes(1);
  await conn.open("attempt", "pane");
  await pane.close();
  expect(conn.panes.size).toBe(1); // an old pane cannot remove its replacement
  expect(command).toHaveBeenCalledTimes(2); // admissions only
  conn.close();
});
it("a shell exiting before its open reply cannot reappear as an admitted terminal", async () => {
  const { conn, socket, messages } = await setup();
  conn.receive({ type: "browser-pane-closed", pane: "pane" });
  socket.send = (data: string) => {
    messages.push(JSON.parse(data));
  };
  const opened = conn.open("attempt", "pane");
  await Promise.resolve();
  const request = messages.at(-1);
  conn.receive({ type: "browser-pane-closed", pane: "pane" });
  conn.receive({
    type: "browser-result",
    id: request.id,
    result: { proof: {} },
  });
  await opened;
  expect(conn.panes.size).toBe(0);
  conn.close();
});
it.each(["throw", "callback"])(
  "a socket send %s failure leaves no pending request or timeout",
  async (kind) => {
    vi.useFakeTimers();
    const { conn, socket } = await setup();
    socket.send = ((_data: string, callback: (error: Error) => void) => {
      if (kind === "throw") throw Error("socket failed");
      callback(Error("socket failed"));
    }) as any;
    await expect((conn as any).request("command", {})).rejects.toThrow(
      "could not be sent",
    );
    expect((conn as any).pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    conn.close();
    expect(conn.alive).toBe(false);
    expect(conn.panes.size).toBe(0);
    await vi.advanceTimersByTimeAsync(120001);
  },
);
it("failed replay on a replacement control socket still expires and clears pending cleanup", async () => {
  vi.useFakeTimers();
  const { conn, socket } = await setup();
  const pending = (conn as any).request("command", {});
  const rejected = expect(pending).rejects.toThrow("SSH connection ended");
  const replacement = Object.assign(new EventEmitter(), {
    send() {
      throw Error("write failed");
    },
    close: vi.fn(() => replacement.emit("close")),
  });
  conn.attach(replacement as any);
  expect(socket.close).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(15001);
  await rejected;
  expect(conn.alive).toBe(false);
  expect((conn as any).pending.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(120001);
});
