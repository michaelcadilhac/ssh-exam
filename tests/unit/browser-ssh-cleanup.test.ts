import { afterEach, expect, it, vi } from "vitest";
import { BrowserSSH } from "../../apps/web/src/browser-ssh.js";
afterEach(() => {
  vi.unstubAllGlobals();
});
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function fixture() {
  const workers: any[] = [];
  class Worker {
    requests: any[] = [];
    onmessage: any;
    onerror: any;
    terminate = vi.fn();
    constructor() {
      workers.push(this);
    }
    postMessage(m: any) {
      this.requests.push(m);
    }
    respond(m: any) {
      this.onmessage({ data: m });
    }
  }
  vi.stubGlobal("Worker", Worker);
  const client = new BrowserSSH(),
    events: any[] = [];
  client.subscribe((m) => events.push(m));
  const control = () => ({
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
  });
  const start = async (features = {}) => {
    const socket = control();
    client.begin(socket as any, vi.fn());
    client.handle({
      type: "browser-request",
      id: crypto.randomUUID(),
      op: "connect",
      args: { controlToken: "test" },
    });
    const worker = workers.at(-1),
      request = worker.requests.at(-1);
    worker.respond({ type: "rpc-result", id: request.id, result: features });
    await flush();
    return { socket, worker };
  };
  return { client, c: client as any, events, start };
}
it("the loaded JS producer explicitly negotiates framing separately from the WASM module", async () => {
  const { client, start } = fixture();
  const { socket } = await start();
  expect(
    socket.send.mock.calls.map(([value]: any[]) => JSON.parse(value)),
  ).toContainEqual(
    expect.objectContaining({
      type: "browser-result",
      result: {
        loaded_pane_input: "v1",
        loaded_pane_epoch_change: "v1",
        loaded_control_retention: "v1",
        loaded_control_restore: "v1",
      },
    }),
  );
  client.close();
});
const retainedOwner = () => ({
  attempt: crypto.randomUUID(),
  exam: "midterm",
  username: "student",
  uid: 10001,
  transport_hash: "a".repeat(64),
  boot: crypto.randomUUID(),
  page_epoch: "b".repeat(64),
  input_epoch: "c".repeat(64),
  generation: 0,
  clock_revision: 0,
});
it("retained control offers only negotiated routing metadata and never restarts SSH or retains unknown connect fields", async () => {
  const { client, c, start } = fixture(),
    owner = retainedOwner();
  const { socket, worker } = await start({
    command_cancel: true,
    framed_input: true,
    pane_epoch_change: true,
    privateExtra: "DO-NOT-RETAIN",
  });
  client.retainTransport(true, {
    attempt: owner.attempt,
    page: "d".repeat(64),
    owner: JSON.stringify(owner),
  });
  socket.send.mockClear();
  const requests = worker.requests.length;
  client.handle({
    type: "browser-request",
    id: "restore",
    op: "retained-control",
    args: { owner, controlToken: "replacement" },
  });
  await flush();
  const result = JSON.parse(socket.send.mock.calls.at(-1)![0]).result;
  expect(result).toMatchObject({
    retained_control: "v1",
    loaded_control_restore: "v1",
    framed_input: true,
    panes: [],
  });
  expect(result).not.toHaveProperty("privateExtra");
  expect(worker.requests).toHaveLength(requests);
  expect(worker.terminate).not.toHaveBeenCalled();
  expect(c.token).toBe("replacement");
  client.close();
  expect(c.retainedContext).toBeUndefined();
  expect(c.retainedFeatures).toBeUndefined();
});
it("a mismatched retained owner refuses before token change and preserves the authenticated worker", async () => {
  const { client, c, start } = fixture(),
    owner = retainedOwner();
  const { socket, worker } = await start();
  client.retainTransport(true, {
    attempt: owner.attempt,
    page: "d".repeat(64),
    owner: JSON.stringify(owner),
  });
  socket.send.mockClear();
  client.handle({
    type: "browser-request",
    id: "wrong",
    op: "retained-control",
    args: {
      owner: { ...owner, transport_hash: "e".repeat(64) },
      controlToken: "wrong-token",
    },
  });
  await flush();
  expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toMatchObject({
    type: "browser-result",
    id: "wrong",
    error: true,
  });
  expect(c.token).toBe("test");
  expect(client.active).toBe(true);
  expect(worker.terminate).not.toHaveBeenCalled();
  client.close();
});
it("late old-gateway command replies cannot contaminate a restored control socket", async () => {
  const { client, start } = fixture(),
    owner = retainedOwner();
  const { socket, worker } = await start();
  client.retainTransport(true, {
    attempt: owner.attempt,
    page: "d".repeat(64),
    owner: JSON.stringify(owner),
  });
  client.handle({
    type: "browser-request",
    id: "old-command",
    op: "command",
    args: {},
  });
  const old = worker.requests.at(-1);
  socket.send.mockClear();
  client.handle({
    type: "browser-request",
    id: "restore",
    op: "retained-control",
    args: { owner, controlToken: "replacement" },
  });
  await flush();
  worker.respond({ type: "rpc-result", id: old.id, result: { old: true } });
  await flush();
  expect(
    socket.send.mock.calls.map(([value]: any[]) => JSON.parse(value).id),
  ).toEqual(["restore"]);
  client.close();
});
it.each(["error", "loss", "fatal"])(
  "retaining authenticated control never suppresses %s or survives a new login",
  async (failure) => {
    const { client, c, events, start } = fixture();
    const { worker } = await start();
    client.retainTransport(true);
    expect(c.retainedTransport).toBe(true);
    events.length = 0;
    if (failure === "error") worker.onerror();
    else worker.respond({ type: failure });
    expect(events).toEqual([{ type: "loss" }]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(client.active).toBe(false);
    expect(c.retainedTransport).toBe(false);
    await start();
    expect(c.retainedTransport).toBe(false);
    client.close();
  },
);
it("logout clears workers, control socket, callbacks, reply cache and authentication listener", async () => {
  const { client, c, start } = fixture();
  const { worker, socket } = await start();
  const pending = c.request("command", {});
  const rejected = expect(pending).rejects.toThrow("ended");
  client.close();
  client.close();
  await rejected;
  await flush();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(socket.close).toHaveBeenCalledTimes(1);
  for (const name of [
    "callbacks",
    "controlReplies",
    "openingPanes",
    "inputChains",
    "paneInputOwners",
    "buffers",
  ])
    expect(c[name].size).toBe(0);
  expect(c.authListener).toBeUndefined();
  expect(c.control).toBeUndefined();
  expect(client.active).toBe(false);
});
it("late worker events and old rejected commands cannot affect a later login", async () => {
  const { client, c, events, start } = fixture();
  const first = await start();
  client.handle({
    type: "browser-request",
    id: "old-open",
    op: "open",
    args: { pane: "old" },
  });
  const second = await start();
  await flush();
  events.length = 0;
  second.socket.send.mockClear();
  first.worker.respond({ type: "closed", pane: "old" });
  first.worker.respond({ type: "fatal" });
  first.worker.onerror();
  await flush();
  expect(events).toEqual([]);
  expect(second.socket.send).not.toHaveBeenCalled();
  expect(client.active).toBe(true);
  expect(c.readyPanes.size).toBe(0);
  client.close();
});
it("natural terminal exit notifies only its server slot and a late open reply cannot restore input", async () => {
  const { client, c, start } = fixture();
  const { worker, socket } = await start();
  client.handle({
    type: "browser-request",
    id: "open",
    op: "open",
    args: { pane: "pane" },
  });
  const request = worker.requests.at(-1);
  worker.respond({ type: "closed", pane: "pane" });
  worker.respond({ type: "rpc-result", id: request.id, result: {} });
  await flush();
  expect(c.readyPanes.has("pane")).toBe(false);
  expect(
    socket.send.mock.calls.map((call) => JSON.parse(call[0])),
  ).toContainEqual({ v: 1, type: "browser-pane-closed", pane: "pane" });
  client.close();
});
it("terminal close uses the authorized server path once and drops queued input to that pane", async () => {
  const { client, c, start } = fixture();
  const { worker } = await start();
  client.setInputEnabled(true);
  c.readyPanes.add("one");
  c.readyPanes.add("two");
  client.terminal({ type: "input", pane: "one", data: "queued" });
  expect(client.terminal({ type: "close", pane: "one" })).toBe(false);
  await flush();
  expect(
    worker.requests.filter(
      (m: any) => m.op === "close-pane" || m.op === "input",
    ),
  ).toEqual([]);
  expect(c.readyPanes.has("two")).toBe(true);
  client.close();
});
it("natural exit fences old unsent input and late RPC errors from a replacement pane without blocking another pane", async () => {
  const { client, c, events, start } = fixture();
  const { worker } = await start();
  client.setInputEnabled(true);
  c.readyPanes.add("same");
  c.readyPanes.add("independent");
  client.terminal({ type: "input", pane: "same", data: "in-flight" });
  await flush();
  const first = worker.requests.at(-1);
  expect(first.op).toBe("input");
  client.terminal({ type: "input", pane: "same", data: "stale-unsent" });
  const oldChain = c.inputChains.get("same");
  worker.respond({ type: "closed", pane: "same" });
  client.handle({
    type: "browser-request",
    id: "replacement-open",
    op: "open",
    args: { pane: "same" },
  });
  const open = worker.requests.at(-1);
  worker.respond({ type: "rpc-result", id: open.id, result: {} });
  await flush();
  expect(c.readyPanes.has("same")).toBe(true);
  client.terminal({ type: "input", pane: "independent", data: "healthy" });
  client.terminal({ type: "input", pane: "same", data: "fresh" });
  await flush();
  expect(
    worker.requests
      .filter((r: any) => r.op === "input")
      .map((r: any) => r.args),
  ).toEqual([
    { pane: "same", data: "in-flight" },
    { pane: "independent", data: "healthy" },
    { pane: "same", data: "fresh" },
  ]);
  events.length = 0;
  worker.respond({
    type: "rpc-result",
    id: first.id,
    error: "old pane exited",
  });
  await oldChain;
  await flush();
  expect(events).toEqual([]);
  expect(c.readyPanes.has("same")).toBe(true);
  expect(c.readyPanes.has("independent")).toBe(true);
  client.close();
  await flush();
  expect(c.paneInputOwners.size).toBe(0);
});
it("late framed EOF and output cannot affect the gap or a replacement with the same pane ID", async () => {
  const { client, c, events, start } = fixture();
  const { worker, socket } = await start();
  const old = "a".repeat(64),
    fresh = "b".repeat(64);
  const open = async (epoch: string) => {
    client.handle({
      type: "browser-request",
      id: epoch,
      op: "open",
      args: { pane: "same", input_epoch: epoch },
    });
    worker.respond({
      type: "rpc-result",
      id: worker.requests.at(-1).id,
      result: {},
    });
    await flush();
  };
  await open(old);
  client.terminal({ type: "close", pane: "same" });
  const before = socket.send.mock.calls.length;
  worker.respond({ type: "closed", pane: "same", input_epoch: old });
  await open(fresh);
  worker.respond({ type: "closed", pane: "same", input_epoch: old });
  worker.respond({
    type: "output",
    pane: "same",
    input_epoch: old,
    data: "old",
  });
  expect(
    events.filter((m) => ["closed", "output", "loss"].includes(m.type)),
  ).toEqual([]);
  expect(
    socket.send.mock.calls
      .slice(before)
      .map(([value]: any[]) => JSON.parse(value).type),
  ).not.toContain("browser-pane-closed");
  expect(c.readyPanes.has("same")).toBe(true);
  worker.respond({
    type: "output",
    pane: "same",
    input_epoch: fresh,
    data: "fresh",
  });
  expect(events.at(-1)).toMatchObject({ type: "output", input_epoch: fresh });
  client.close();
});

it("retained input rotation preserves same-pane output, discards old keys, and never resets a retry's sequence", async () => {
  const { client, c, events, start } = fixture();
  const { worker, socket } = await start();
  const original = "a".repeat(64),
    next = "b".repeat(64);
  client.handle({
    type: "browser-request",
    id: "open",
    op: "open",
    args: { pane: "same", input_epoch: original },
  });
  worker.respond({
    type: "rpc-result",
    id: worker.requests.at(-1).id,
    result: {},
  });
  await flush();
  client.setInputEnabled(false);
  const change = (id: string) =>
    client.handle({
      type: "browser-request",
      id,
      op: "change-input-epoch",
      args: { pane: "same", instance: original, previous: original, next },
    });
  change("continue");
  const pending = worker.requests.at(-1);
  expect(pending.op).toBe("change-input-epoch");
  // The shell may redraw before the input handshake reply. Its physical pane
  // survives even though its output carries the newly accepted input epoch.
  worker.respond({
    type: "output",
    pane: "same",
    pane_instance: original,
    input_epoch: next,
    data: "editor-redraw",
  });
  expect(events.at(-1)).toMatchObject({
    type: "output",
    data: "editor-redraw",
  });
  worker.respond({ type: "rpc-result", id: pending.id, result: {} });
  await flush();
  client.setInputEnabled(true);
  client.terminal({
    type: "input",
    pane: "same",
    data: "STALE",
    input: { epoch: original, sequence: 8 },
  });
  client.terminal({
    type: "input",
    pane: "same",
    data: "fresh",
    input: { epoch: next, sequence: 1 },
  });
  await flush();
  const fresh = worker.requests.at(-1);
  expect(fresh.op).toBe("input-framed");
  worker.respond({ type: "rpc-result", id: fresh.id, result: {} });
  await c.inputChains.get("same");
  expect(
    worker.requests
      .filter((r: any) => r.op === "input-framed")
      .map((r: any) => r.args),
  ).toEqual([{ pane: "same", epoch: next, sequence: 1, data: "fresh" }]);
  change("exact-retry");
  await flush();
  expect(
    worker.requests.filter((r: any) => r.op === "change-input-epoch"),
  ).toHaveLength(1);
  client.terminal({
    type: "input",
    pane: "same",
    data: "REPLAY",
    input: { epoch: next, sequence: 1 },
  });
  await flush();
  expect(
    worker.requests.filter((r: any) => r.op === "input-framed"),
  ).toHaveLength(1);
  worker.respond({
    type: "closed",
    pane: "same",
    pane_instance: original,
    input_epoch: original,
  });
  expect(c.readyPanes.has("same")).toBe(false);
  expect(
    socket.send.mock.calls.map(([value]: any[]) => JSON.parse(value)),
  ).toContainEqual(
    expect.objectContaining({
      type: "browser-pane-closed",
      pane_instance: original,
    }),
  );
  client.close();
});

it("a retained rotation completing after pane replacement cannot update or close the replacement", async () => {
  const { client, c, events, start } = fixture();
  const { worker, socket } = await start();
  const original = "a".repeat(64),
    replacement = "c".repeat(64);
  const open = async (epoch: string) => {
    client.handle({
      type: "browser-request",
      id: epoch,
      op: "open",
      args: { pane: "same", input_epoch: epoch },
    });
    worker.respond({
      type: "rpc-result",
      id: worker.requests.at(-1).id,
      result: {},
    });
    await flush();
  };
  await open(original);
  client.handle({
    type: "browser-request",
    id: "old-continue",
    op: "change-input-epoch",
    args: {
      pane: "same",
      instance: original,
      previous: original,
      next: "b".repeat(64),
    },
  });
  const pending = worker.requests.at(-1);
  client.terminal({ type: "close", pane: "same" });
  await open(replacement);
  worker.respond({ type: "rpc-result", id: pending.id, result: {} });
  await flush();
  expect(c.nativeInput.get("same").epoch).toBe(replacement);
  worker.respond({
    type: "closed",
    pane: "same",
    pane_instance: original,
    input_epoch: replacement,
  });
  expect(c.readyPanes.has("same")).toBe(true);
  expect(events.filter((m) => m.type === "closed")).toEqual([]);
  expect(
    socket.send.mock.calls.map(([value]: any[]) => JSON.parse(value)),
  ).toContainEqual(
    expect.objectContaining({ id: "old-continue", error: true }),
  );
  client.close();
});

it("worker postMessage and control send failures do not retain callbacks or throw in reply handlers", async () => {
  const { client, c, start } = fixture();
  const { worker, socket } = await start();
  worker.postMessage = () => {
    throw Error("worker gone");
  };
  await expect(c.request("resize", {})).rejects.toThrow("worker unavailable");
  expect(c.callbacks.size).toBe(0);
  socket.send.mockImplementation(() => {
    throw Error("socket gone");
  });
  expect(() => worker.respond({ type: "closed", pane: "pane" })).not.toThrow();
  expect(socket.close).toHaveBeenCalled();
  client.close();
});
