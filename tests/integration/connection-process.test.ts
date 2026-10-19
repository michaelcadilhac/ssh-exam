import { it, expect, vi } from "vitest";
import { Agent } from "../../apps/server/src/agent.js";
import { IsolatedConnection } from "../../apps/server/src/connection-process.js";
import { hosts } from "../fixtures/hosts.js";
const entry = new URL(
  "../fixtures/faulting-connection-worker.ts",
  import.meta.url,
);
const exited = async (c: IsolatedConnection) =>
  vi.waitFor(
    () => {
      const child = (c as any).child;
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    },
    { timeout: 5000 },
  );
it("a fatal worker rejects pending operations, removes panes, and leaves another real SSH connection usable", async () => {
  const h = await hosts({ mfaDelayMs: 10 });
  const config: any = {
    mode: "development",
    jump: h.jump,
    class: h.class,
    agent: h.agentConfig,
  };
  const authority = new Agent(config.agent);
  const a = new IsolatedConnection(
    "alice",
    "e",
    config,
    authority,
    false,
    undefined,
    entry,
  );
  const b = new IsolatedConnection("bob", "e", config, authority);
  let release: (() => void) | undefined;
  const failures: any[] = [];
  a.onFailure = (f) => failures.push(f);
  try {
    await Promise.all([
      a.connect(async (_, __, prompts) => prompts.map(() => "shared-password")),
      b.connect(async (_, __, prompts) => prompts.map(() => "shared-password")),
    ]);
    const one = await a.open("a", "one"),
      two = await b.open("b", "two");
    one.resume();
    const data: string[] = [];
    two.on("data", (chunk: Buffer) => data.push(chunk.toString()));
    two.resume();
    h.control.command = (op) =>
      op === "pending"
        ? new Promise((resolve) => {
            release = () => resolve({});
          })
        : Promise.resolve({ healthy: true });
    const pending = a.command("pending");
    const rejected = expect(pending).rejects.toThrow(
      "Attempt connection ended",
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    (a as any).child.send({ kind: "fixture-fault", fault: "exception" });
    await rejected;
    await exited(a);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ cause: "exit", code: 1 });
    expect(a.alive).toBe(false);
    expect(a.panes.size).toBe(0);
    expect((a as any).replies.size).toBe(0);
    expect(authority.connected("alice")).toBe(false);
    expect(b.alive).toBe(true);
    expect(authority.connected("bob")).toBe(true);
    expect(b.panes.size).toBe(1);
    two.write("still-working\n");
    await vi.waitFor(() =>
      expect(data.join("")).toContain("Echo: still-working"),
    );
    expect(await b.command("health")).toEqual({ healthy: true });
    expect(JSON.stringify(failures)).not.toContain("synthetic-private-secret");
    // A late response from the dead worker cannot revive it or remove Bob's pane.
    (a as any).receiveWorker({ kind: "reply", id: 1, alive: true, result: {} });
    expect(a.alive).toBe(false);
    expect(b.panes.size).toBe(1);
  } finally {
    release?.();
    a.close();
    b.close();
    await Promise.all([exited(a), exited(b)]);
    await h.close();
  }
});
it("intentional close is idempotent, exits the child and never raises a failure email event", async () => {
  const h = await hosts({ mfaDelayMs: 10 });
  const config: any = {
    mode: "development",
    jump: h.jump,
    class: h.class,
    agent: h.agentConfig,
  };
  const c = new IsolatedConnection(
    "student",
    "e",
    config,
    new Agent(config.agent),
  );
  const failure = vi.fn();
  c.onFailure = failure;
  try {
    await c.connect(async (_, __, prompts) =>
      prompts.map(() => "shared-password"),
    );
    await c.open("a", "one");
    c.close();
    c.close();
    await exited(c);
    expect(failure).not.toHaveBeenCalled();
    expect(c.panes.size).toBe(0);
    expect((c as any).replies.size).toBe(0);
  } finally {
    c.close();
    await h.close();
  }
});
it("refuses new workers at capacity without disconnecting an existing student and releases capacity after exit", async () => {
  const h = await hosts({ mfaDelayMs: 10 });
  const config: any = {
    mode: "development",
    jump: h.jump,
    class: h.class,
    agent: h.agentConfig,
    connectionWorkers: 1,
  };
  const authority = new Agent(config.agent);
  const a = new IsolatedConnection("alice", "e", config, authority);
  let b: IsolatedConnection | undefined;
  try {
    await a.connect(async (_, __, prompts) =>
      prompts.map(() => "shared-password"),
    );
    expect(() => new IsolatedConnection("bob", "e", config, authority)).toThrow(
      "capacity",
    );
    expect(a.alive).toBe(true);
    a.close();
    await exited(a);
    b = new IsolatedConnection("bob", "e", config, authority);
    await b.connect(async (_, __, prompts) =>
      prompts.map(() => "shared-password"),
    );
    expect(b.alive).toBe(true);
  } finally {
    a.close();
    b?.close();
    await Promise.all([exited(a), ...(b ? [exited(b)] : [])]);
    await h.close();
  }
});

it("contains an exception in a proxy event listener and clears teardown even when a close listener throws", async () => {
  const h = await hosts({ mfaDelayMs: 10 });
  const config: any = {
    mode: "development",
    jump: h.jump,
    class: h.class,
    agent: h.agentConfig,
  };
  const c = new IsolatedConnection(
    "student",
    "e",
    config,
    new Agent(config.agent),
  );
  const failures: any[] = [];
  c.onFailure = (f) => failures.push(f);
  try {
    await c.connect(async (_, __, prompts) =>
      prompts.map(() => "shared-password"),
    );
    const pane = await c.open("a", "one");
    pane.on("data", () => {
      throw Error("private-terminal-text");
    });
    pane.on("close", () => {
      throw Error("private-close-text");
    });
    pane.resume();
    pane.write("callback-fault\n");
    await vi.waitFor(() => expect(failures).toHaveLength(1));
    await exited(c);
    expect(failures[0].cause).toBe("supervisor-callback");
    expect(JSON.stringify(failures)).not.toContain("private-");
    expect(c.panes.size).toBe(0);
    expect((c as any).replies.size).toBe(0);
  } finally {
    c.close();
    await h.close();
  }
});
