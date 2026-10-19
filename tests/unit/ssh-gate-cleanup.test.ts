import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Connection } from "../../apps/server/src/ssh.js";
afterEach(() => vi.useRealTimers());
function fixture() {
  const conn = new Connection(
    "student",
    {} as any,
    { unbind: () => {} } as any,
  );
  const channel = Object.assign(new EventEmitter(), {
    close: vi.fn(),
    pause: vi.fn(),
    unshift: vi.fn(),
    write: vi.fn(),
  });
  // Real exec channels retain a benign post-admission error listener.
  channel.on("error", () => {});
  return { conn: conn as any, channel };
}
it.each(["close", "error", "timeout", "rejection"])(
  "fallback SSH admission %s releases listeners and timers",
  async (kind) => {
    vi.useFakeTimers();
    const { conn, channel } = fixture();
    const pending = conn.handshake(channel, "token");
    const rejected = expect(pending).rejects.toThrow();
    if (kind === "timeout") await vi.advanceTimersByTimeAsync(10001);
    else if (kind === "rejection")
      channel.emit("data", Buffer.from("EXAM-ERROR denied\n"));
    else if (kind === "error") channel.emit("error", Error("channel error"));
    else channel.emit("close");
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(channel.listenerCount("data")).toBe(0);
    expect(channel.listenerCount("close")).toBe(0);
    expect(channel.listenerCount("error")).toBe(1);
    expect(channel.close).toHaveBeenCalledTimes(1);
  },
);
it("successful fallback admission removes its close handler and preserves initial terminal bytes", async () => {
  vi.useFakeTimers();
  const { conn, channel } = fixture();
  const pending = conn.handshake(channel, "token");
  channel.emit(
    "data",
    Buffer.from('EXAM-GATE/1\nEXAM-READY {"ok":true}\nhello'),
  );
  expect(await pending).toEqual({ ok: true });
  expect(channel.unshift).toHaveBeenCalledWith(Buffer.from("hello"));
  expect(vi.getTimerCount()).toBe(0);
  expect(channel.listenerCount("close")).toBe(0);
  channel.emit("error", Error("late channel error"));
});
