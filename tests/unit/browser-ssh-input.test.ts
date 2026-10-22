import { afterEach, expect, it, vi } from "vitest";
import { BrowserSSH } from "../../apps/web/src/browser-ssh.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function fixture() {
  const client = new BrowserSSH(),
    c = client as any;
  c.worker = { terminate: vi.fn() };
  c.browserMode = true;
  c.controlReady = true;
  const request = vi.spyOn(c, "request").mockResolvedValue({});
  client.setInputEnabled(true);
  return { client, c, request };
}
it("drops input while blocked and clears early terminal input across recovery", async () => {
  const { client, c, request } = fixture();
  client.terminal({ type: "input", pane: "a", data: "early" });
  expect(c.earlyInputs.get("a")).toEqual(["early"]);
  client.setInputEnabled(false);
  client.terminal({ type: "input", pane: "a", data: "blocked" });
  expect(c.earlyInputs.size).toBe(0);
  client.setInputEnabled(true);
  client.handle({
    type: "browser-request",
    id: "open",
    op: "open",
    args: { pane: "a" },
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(request.mock.calls.map((c) => c[0])).toEqual(["open"]);
  client.terminal({ type: "input", pane: "a", data: "fresh" });
  await c.inputChains.get("a");
  expect(request).toHaveBeenLastCalledWith("input", {
    pane: "a",
    data: "fresh",
  });
  client.close();
});
it("invalidates queued worker writes even if input is re-enabled before the microtask runs", async () => {
  const { client, c, request } = fixture();
  c.readyPanes.add("a");
  client.terminal({ type: "input", pane: "a", data: "old" });
  client.setInputEnabled(false);
  client.setInputEnabled(true);
  await c.inputChains.get("a");
  expect(request).not.toHaveBeenCalled();
  c.controlReady = false;
  client.terminal({ type: "input", pane: "a", data: "unbound" });
  await Promise.resolve();
  expect(request).not.toHaveBeenCalled();
  c.controlReady = true;
  client.terminal({ type: "input", pane: "a", data: "new" });
  await c.inputChains.get("a");
  expect(request).toHaveBeenCalledExactlyOnceWith("input", {
    pane: "a",
    data: "new",
  });
  client.close();
});
it("a delayed control acknowledgment after 15 seconds terminates SSH rather than restoring input", () => {
  vi.useFakeTimers();
  const sockets: any[] = [];
  class Socket {
    onmessage: any;
    onopen: any;
    listeners = new Map();
    readyState = 1;
    constructor() {
      sockets.push(this);
    }
    addEventListener(name: string, cb: any) {
      this.listeners.set(name, cb);
    }
    send() {}
    close() {}
  }
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("location", { protocol: "https:", host: "example.test" });
  const { client, c } = fixture(),
    events: any[] = [];
  client.subscribe((v) => events.push(v));
  c.disconnected = performance.now();
  c.reconnect();
  vi.advanceTimersByTime(15001);
  sockets[0].onmessage({ data: JSON.stringify({ type: "browser-bound" }) });
  expect(client.active).toBe(false);
  expect(client.controlConnected).toBe(false);
  expect(c.disconnected).toBe(0);
  expect(events).toContainEqual({ type: "loss" });
});

for (const fail of [false, true])
  it(`does not forward queued bytes or a late ${fail ? "failure" : "success"} to a replacement pane with the same identifier`, async () => {
    const { client, c, request } = fixture(),
      events: any[] = [];
    client.subscribe((m) => events.push(m));
    let settle!: () => void;
    const pending = new Promise((resolve, reject) => {
      settle = () => (fail ? reject(Error("old pane ended")) : resolve({}));
    });
    request.mockImplementation(async (...values: unknown[]) => {
      const [op, args] = values as [string, { data?: string }];
      if (op === "input" && args.data === "already-in-flight") return pending;
      return {};
    });
    c.readyPanes.add("same");
    client.terminal({ type: "input", pane: "same", data: "already-in-flight" });
    await Promise.resolve();
    client.terminal({ type: "input", pane: "same", data: "stale-unsent" });
    const oldChain = c.inputChains.get("same");
    client.terminal({ type: "close", pane: "same" });
    client.handle({
      type: "browser-request",
      id: "replacement-open",
      op: "open",
      args: { pane: "same" },
    });
    for (let n = 0; n < 8; n++) await Promise.resolve();
    expect(c.readyPanes.has("same")).toBe(true);
    settle();
    await oldChain;
    for (let n = 0; n < 8; n++) await Promise.resolve();
    expect(request.mock.calls.filter(([op]) => op === "input")).toEqual([
      ["input", { pane: "same", data: "already-in-flight" }],
    ]);
    expect(events.filter((m) => m.type === "closed")).toEqual([]);
    client.terminal({ type: "input", pane: "same", data: "fresh" });
    await c.inputChains.get("same");
    expect(request).toHaveBeenLastCalledWith("input", {
      pane: "same",
      data: "fresh",
    });
    client.close();
  });
