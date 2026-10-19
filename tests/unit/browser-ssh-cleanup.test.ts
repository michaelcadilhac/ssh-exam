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
  const start = async () => {
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
    worker.respond({ type: "rpc-result", id: request.id, result: {} });
    await flush();
    return { socket, worker };
  };
  return { client, c: client as any, events, start };
}
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
