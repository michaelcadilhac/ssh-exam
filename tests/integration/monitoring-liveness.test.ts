import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  liveMonitoring,
  monitoringReady,
} from "../fixtures/live-monitoring.js";

it("acknowledges fresh monitoring independently of a stuck signed renewal while HTTP captures and an authenticated SSH pane stay healthy", async () => {
  const f = await liveMonitoring();
  let release: (() => void) | undefined;
  let renewalStarted = false;
  let renewals = 0;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.h.control.command = async (op, body) => {
    if (op === "renew-execution-lease") {
      renewals++;
      renewalStarted = true;
      await pending;
      return { id: f.id, state: "ACTIVE", deadline: f.deadline, generation: 0 };
    }
    return f.h.agent.call(op, body);
  };
  try {
    const pane = await f.connection.open(f.id, randomUUID());
    let output = "";
    pane.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    pane.resume();
    const confirmation = randomUUID();
    f.send({ type: "heartbeat", confirmation, ready: monitoringReady });
    await vi.waitFor(() => expect(renewalStarted).toBe(true));
    expect((await f.capture()).map((r) => r.statusCode)).toEqual([200, 200]);
    pane.write("monitoring-independent-pty\n");
    await vi.waitFor(() =>
      expect(output).toContain("Echo: monitoring-independent-pty"),
    );
    expect(f.connection.alive).toBe(true);
    // RED on the serial handler: no confirmation arrives until the deliberately
    // stalled SSH command returns, although the other live interfaces work.
    await vi.waitFor(
      () =>
        expect(
          f.messages.some(
            (m) =>
              m.type === "monitoring-contact" &&
              m.confirmation === confirmation,
          ),
        ).toBe(true),
      { timeout: 500, interval: 10 },
    );
    const receipt = f.messages.find((m) => m.type === "monitoring-contact");
    expect(receipt).toEqual({
      v: 1,
      type: "monitoring-contact",
      attempt: f.id,
      confirmation,
    });
    expect(receipt.attempt?.state).toBeUndefined();
    expect(f.store.attempt(f.id).state).toBe("ACTIVE");
    expect(f.store.db.prepare("SELECT * FROM incidents").all()).toEqual([]);
    const confirmations = Array.from({ length: 8 }, () => randomUUID());
    for (const next of confirmations)
      f.send({ type: "heartbeat", confirmation: next, ready: monitoringReady });
    await vi.waitFor(() =>
      expect(
        confirmations.every((next) =>
          f.messages.some(
            (m) => m.type === "monitoring-contact" && m.confirmation === next,
          ),
        ),
      ).toBe(true),
    );
    expect(renewals).toBe(1); // Bounded in-flight native work, not an RPC per queued pulse.
    expect(
      f.messages.filter((m) => m.type === "state" && m.confirmation).length,
    ).toBe(8);
  } finally {
    release?.();
    await f.close();
  }
}, 20000);

it("monitoring and a genuine policy report are not queued behind a hung pane admission", async () => {
  const f = await liveMonitoring();
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let opening = false,
    renewals = 0;
  f.h.control.command = async (op, body) => {
    if (op === "issue-channel-admission") {
      opening = true;
      await pending;
      throw Error("Synthetic admission revoked by policy lock");
    }
    if (op === "renew-execution-lease") {
      renewals++;
      return {};
    }
    if (op === "lock-attempt") return {};
    return f.h.agent.call(op, body);
  };
  try {
    f.send({ type: "open", pane: randomUUID() });
    await vi.waitFor(() => expect(opening).toBe(true));
    const confirmation = randomUUID();
    f.send({ type: "heartbeat", confirmation, ready: monitoringReady });
    await vi.waitFor(() =>
      expect(
        f.messages.some(
          (m) => m.type === "state" && m.confirmation === confirmation,
        ),
      ).toBe(true),
    );
    expect(renewals).toBe(1);
    f.send({ type: "incident", reason: "Workspace exited fullscreen" });
    await vi.waitFor(() => expect(f.store.attempt(f.id).state).toBe("LOCKED"));
    expect(f.store.attempt(f.id).reason).toBe("Workspace exited fullscreen");
    expect(f.store.attempt(f.id).deadline).toBe(f.deadline);
  } finally {
    release();
    await f.close();
  }
}, 20000);

it("rejects malformed monitoring and retired page ownership without acknowledging or renewing", async () => {
  const f = await liveMonitoring();
  let renewals = 0;
  f.h.control.command = async () => {
    renewals++;
    return {};
  };
  try {
    const before = f.store.attempt(f.id);
    const invalid = randomUUID();
    f.send({
      type: "heartbeat",
      confirmation: invalid,
      ready: { ...monitoringReady, screen: false },
    });
    await vi.waitFor(() =>
      expect(f.messages.some((m) => m.type === "error")).toBe(true),
    );
    expect(f.messages.some((m) => m.confirmation === invalid)).toBe(false);
    expect(f.store.attempt(f.id).last_contact).toBe(before.last_contact);
    f.store.db
      .prepare("UPDATE attempts SET page_hash='replacement-page' WHERE id=?")
      .run(f.id);
    const retired = randomUUID();
    f.send({
      type: "heartbeat",
      confirmation: retired,
      ready: monitoringReady,
    });
    await vi.waitFor(() =>
      expect(
        f.messages.some(
          (m) => m.type === "error" && m.error.includes("no longer owns"),
        ),
      ).toBe(true),
    );
    expect(f.messages.some((m) => m.confirmation === retired)).toBe(false);
    expect(renewals).toBe(0);
    expect(f.store.attempt(f.id).state).toBe("ACTIVE");
  } finally {
    await f.close();
  }
}, 20000);

it("a late successful renewal cannot turn a policy lock or finished attempt into new work permission", async () => {
  const f = await liveMonitoring();
  let release = () => {},
    started = false;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.h.control.command = async (op) => {
    if (op === "renew-execution-lease") {
      started = true;
      await pending;
      return { state: "ACTIVE" };
    }
    return {};
  };
  try {
    f.send({
      type: "heartbeat",
      confirmation: randomUUID(),
      ready: monitoringReady,
    });
    await vi.waitFor(() => expect(started).toBe(true));
    f.send({ type: "incident", reason: "Document became hidden" });
    await vi.waitFor(() => expect(f.store.attempt(f.id).state).toBe("LOCKED"));
    release();
    const confirmation = randomUUID();
    f.send({ type: "heartbeat", confirmation, ready: monitoringReady });
    await vi.waitFor(() =>
      expect(
        f.messages.some(
          (m) => m.type === "state" && m.confirmation === confirmation,
        ),
      ).toBe(true),
    );
    expect(
      f.messages.some(
        (m) =>
          m.type === "monitoring-contact" && m.confirmation === confirmation,
      ),
    ).toBe(false);
    expect(f.store.attempt(f.id)).toMatchObject({
      state: "LOCKED",
      generation: 1,
      reason: "Document became hidden",
      deadline: f.deadline,
      protected: 0,
    });
  } finally {
    release();
    await f.close();
  }
}, 20000);
