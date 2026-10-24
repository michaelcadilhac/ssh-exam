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
  expect(c.earlyInputs.get("a").map((value: any) => value.data)).toEqual([
    "early",
  ]);
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

it("preserves captured native contexts and orders resize with input across the worker queue", async () => {
  const { client, c, request } = fixture();
  const epoch = "a".repeat(64),
    events: any[] = [];
  client.subscribe((m) => events.push(m));
  client.handle({
    type: "browser-request",
    id: "framed-open",
    op: "open",
    args: { pane: "same", input_epoch: epoch },
  });
  for (let n = 0; n < 8; n++) await Promise.resolve();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  request.mockImplementation(async (...values: unknown[]) => {
    const [op, args] = values as [string, { data?: string }];
    if (op === "input-framed" && args.data === "first") await pending;
    return {};
  });
  const first = { epoch, sequence: 1 },
    second = { epoch, sequence: 2 },
    third = { epoch, sequence: 3 };
  expect(
    client.terminal({
      type: "input",
      pane: "same",
      data: "first",
      input: first,
    }),
  ).toBe(true);
  await Promise.resolve();
  expect(
    request.mock.calls.filter(([op]) => op === "input-framed"),
  ).toHaveLength(1);
  expect(
    client.terminal({
      type: "resize",
      pane: "same",
      rows: 38,
      cols: 113,
      input: second,
    }),
  ).toBe(true);
  client.terminal({ type: "input", pane: "same", data: "last", input: third });
  // Mutation of the producer's later state must not alter an already captured packet.
  first.epoch = second.epoch = third.epoch = "b".repeat(64);
  first.sequence = second.sequence = third.sequence = 999;
  expect(
    request.mock.calls.filter(
      ([op]) => typeof op === "string" && op.endsWith("-framed"),
    ),
  ).toHaveLength(1);
  release();
  await c.inputChains.get("same");
  expect(
    request.mock.calls.filter(
      ([op]) => typeof op === "string" && op.endsWith("-framed"),
    ),
  ).toEqual([
    ["input-framed", { pane: "same", epoch, sequence: 1, data: "first" }],
    [
      "resize-framed",
      { pane: "same", epoch, sequence: 2, rows: 38, cols: 113 },
    ],
    ["input-framed", { pane: "same", epoch, sequence: 3, data: "last" }],
  ]);
  client.terminal({
    type: "resize",
    pane: "same",
    rows: 39,
    cols: 114,
    input: { epoch, sequence: 3 },
  });
  client.terminal({
    type: "input",
    pane: "same",
    data: "replay",
    input: { epoch, sequence: 3 },
  });
  await c.inputChains.get("same");
  expect(
    request.mock.calls.filter(
      ([op]) => typeof op === "string" && op.endsWith("-framed"),
    ),
  ).toHaveLength(3);
  expect(events.filter((m) => ["loss", "closed"].includes(m.type))).toEqual([]);
  client.close();
});

it("never relabels keys captured before framed admission or falls back to raw input", async () => {
  const { client, c, request } = fixture();
  const epoch = "c".repeat(64);
  client.terminal({
    type: "input",
    pane: "same",
    data: "before-native-context",
  });
  client.handle({
    type: "browser-request",
    id: "framed-open",
    op: "open",
    args: { pane: "same", input_epoch: epoch },
  });
  for (let n = 0; n < 8; n++) await Promise.resolve();
  client.terminal({ type: "input", pane: "same", data: "unscoped" });
  client.terminal({ type: "resize", pane: "same", rows: 38, cols: 113 });
  client.terminal({
    type: "input",
    pane: "same",
    data: "wrong-epoch",
    input: { epoch: "d".repeat(64), sequence: 100 },
  });
  client.terminal({
    type: "input",
    pane: "same",
    data: "fresh",
    input: { epoch, sequence: 1 },
  });
  await c.inputChains.get("same");
  expect(request.mock.calls).toEqual([
    ["open", { pane: "same", input_epoch: epoch }],
    ["input-framed", { pane: "same", epoch, sequence: 1, data: "fresh" }],
  ]);
  client.close();
});

it("does not send optimistic raw resize to a closing or unopened worker incarnation", async () => {
  const { client, c, request } = fixture();
  const epoch = "e".repeat(64),
    events: any[] = [];
  client.subscribe((m) => events.push(m));
  client.handle({
    type: "browser-request",
    id: "open",
    op: "open",
    args: { pane: "same", input_epoch: epoch },
  });
  for (let n = 0; n < 8; n++) await Promise.resolve();
  client.terminal({ type: "close", pane: "same" });
  expect(
    client.terminal({ type: "resize", pane: "same", rows: 38, cols: 113 }),
  ).toBe(false);
  await Promise.resolve();
  expect(request.mock.calls.map(([op]) => op)).toEqual(["open"]);
  expect(events).toEqual([
    { type: "pane-context", pane: "same", instance: epoch },
  ]);
  client.close();
});

for (const [payload, limit] of [
  ["key", 64],
  ["漢".repeat(8000), 2],
] as const)
  it(`bounds framed input waiting for a worker by ${limit === 64 ? "frame count" : "UTF-8 bytes"} without declaring SSH loss`, async () => {
    const { client, c, request } = fixture(),
      events: any[] = [];
    const epoch = "f".repeat(64);
    client.subscribe((m) => events.push(m));
    client.handle({
      type: "browser-request",
      id: "open",
      op: "open",
      args: { pane: "same", input_epoch: epoch },
    });
    for (let n = 0; n < 8; n++) await Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    request.mockImplementation(async (...values: unknown[]) => {
      const [op] = values;
      if (op === "input-framed") await pending;
      return {};
    });
    for (let sequence = 1; sequence <= 1000; sequence++)
      client.terminal({
        type: "input",
        pane: "same",
        data: payload,
        input: { epoch, sequence },
      });
    await Promise.resolve();
    release();
    await c.inputChains.get("same");
    expect(
      request.mock.calls.filter(([op]) => op === "input-framed"),
    ).toHaveLength(limit);
    expect(events).toEqual([
      { type: "pane-context", pane: "same", instance: epoch },
      { type: "input-backpressure", pane: "same" },
    ]);
    expect(events.some((m) => ["loss", "closed"].includes(m.type))).toBe(false);
    client.terminal({
      type: "input",
      pane: "same",
      data: "fresh",
      input: { epoch, sequence: 1001 },
    });
    await c.inputChains.get("same");
    expect(request).toHaveBeenLastCalledWith("input-framed", {
      pane: "same",
      data: "fresh",
      epoch,
      sequence: 1001,
    });
    client.close();
  });
