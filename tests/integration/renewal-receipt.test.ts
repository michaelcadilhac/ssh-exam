import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  liveMonitoring,
  monitoringReady,
} from "../fixtures/live-monitoring.js";

// Actual HTTP/WS/isolated worker/authenticated SSH interfaces. The native policy
// below is a signed simulation; real native journal/cutoff boundaries have their
// own signed-entry and guarded guest qualification, not inferred from this test.
it.each([
  [0, "hold"],
  [2500, "hold"],
  [0, "eof"],
] as const)(
  "recovers repeated lost renewal replies with commit confirmation delayed %d ms (%s)",
  async (commitDelay, fault) => {
    const f = await liveMonitoring({ renewalReceipts: true });
    const receipts = new Map<string, { until: number; attempt: any }>();
    const observed: string[] = [];
    const start = f.store.attempt(f.id).start;
    f.h.control.command = async (op, body, frame) => {
      observed.push(op);
      if (op === "renew-receipted-execution-lease") {
        const until = Date.now() + 15000;
        const attempt = {
          ...f.store.attempt(f.id),
          transport: frame.transport,
          state: "ACTIVE",
          lease: until,
        };
        if (commitDelay)
          await new Promise((resolve) => setTimeout(resolve, commitDelay));
        receipts.set(frame.nonce, { until, attempt });
        return attempt;
      }
      if (op === "execution-renewal-receipt") {
        const original = receipts.get(body.renewal_nonce);
        if (!original) throw Error("No exact committed receipt");
        return {
          version: 1,
          nonce: body.renewal_nonce,
          until: original.until,
          remaining_ms: original.until - Date.now(),
          attempt: original.attempt,
        };
      }
      return f.h.agent.call(op, body);
    };
    f.h.control.dropReply = (frame) =>
      frame.op === "renew-receipted-execution-lease" &&
      (fault === "eof" ? "eof" : true);
    try {
      const pane = await f.connection.open(f.id, randomUUID());
      let output = "";
      pane.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      pane.resume();
      const auth = { ...f.h.authCalls };
      for (let n = 0; n < 3; n++) {
        expect((await f.capture()).map((r) => r.statusCode)).toEqual([
          200, 200,
        ]);
        const confirmation = randomUUID();
        f.send({ type: "heartbeat", confirmation, ready: monitoringReady });
        await vi.waitFor(() => expect(receipts.size).toBe(n + 1), {
          timeout: 4000,
        });
        await vi.waitFor(
          () =>
            expect(
              f.messages.some(
                (m) => m.type === "state" && m.confirmation === confirmation,
              ),
            ).toBe(true),
          { timeout: 5000 },
        );
        await vi.waitFor(() => expect(f.h.control.active).toBe(0), {
          timeout: 1500,
        });
        pane.write(`same-pane-${n}\n`);
        await vi.waitFor(() =>
          expect(output).toContain(`Echo: same-pane-${n}`),
        );
        expect(f.store.attempt(f.id)).toMatchObject({
          state: "ACTIVE",
          start,
          deadline: f.deadline,
          original_deadline: f.deadline,
          generation: 0,
        });
        expect(f.connection.alive).toBe(true);
        expect(f.h.authCalls).toEqual(auth);
      }
      expect(
        observed.filter((op) => op === "renew-receipted-execution-lease"),
      ).toHaveLength(3);
      expect(
        observed.filter((op) => op === "execution-renewal-receipt").length,
      ).toBeGreaterThanOrEqual(3);
      expect(f.h.control.maxActive).toBeLessThanOrEqual(3);
      expect(f.store.db.prepare("SELECT * FROM incidents").all()).toEqual([]);
      expect(f.store.db.prepare("SELECT * FROM continuations").all()).toEqual(
        [],
      );
      expect(f.store.db.prepare("SELECT * FROM outbox").all()).toEqual([]);
    } finally {
      await f.close();
    }
  },
  25000,
);

it.each(["wrong-nonce", "expired", "foreign-negative", "unavailable"])(
  "does not turn a %s probe into permission or an earlier policy lock",
  async (fault) => {
    const f = await liveMonitoring({ renewalReceipts: true });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let nonce = "",
      attempt: any,
      until = 0,
      probes = 0;
    f.h.control.command = async (op, body, frame) => {
      if (op === "renew-receipted-execution-lease") {
        nonce = frame.nonce;
        until = Date.now() + 15000;
        attempt = {
          ...f.store.attempt(f.id),
          transport: frame.transport,
          lease: until,
        };
        await pending;
        return attempt;
      }
      if (op === "execution-renewal-receipt") {
        probes++;
        expect(body.renewal_nonce).toBe(nonce);
        if (fault === "unavailable")
          throw Error("Publication still unconfirmed");
        if (fault === "foreign-negative")
          throw Object.assign(Error("Unrelated native state"), {
            attemptState: {
              ...attempt,
              uid: attempt.uid + 1,
              state: "LOCKED",
              generation: 1,
            },
          });
        return {
          version: 1,
          nonce: fault === "wrong-nonce" ? randomUUID() : nonce,
          until,
          remaining_ms: fault === "expired" ? 0 : until - Date.now(),
          attempt,
        };
      }
      return f.h.agent.call(op, body);
    };
    try {
      const confirmation = randomUUID();
      f.send({ type: "heartbeat", confirmation, ready: monitoringReady });
      await vi.waitFor(() => expect(nonce).not.toBe(""));
      await vi.waitFor(() => expect(probes).toBeGreaterThanOrEqual(2), {
        timeout: 5000,
      });
      await vi.waitFor(() => expect(f.h.control.active).toBe(1));
      expect(
        f.messages.some(
          (m) => m.type === "state" && m.confirmation === confirmation,
        ),
      ).toBe(false);
      expect(f.store.attempt(f.id).state).toBe("ACTIVE");
      expect(f.store.db.prepare("SELECT * FROM incidents").all()).toEqual([]);
      expect(f.store.db.prepare("SELECT * FROM outbox").all()).toEqual([]);
      expect(f.connection.alive).toBe(true);
      release();
      await vi.waitFor(() =>
        expect(
          f.messages.some(
            (m) => m.type === "state" && m.confirmation === confirmation,
          ),
        ).toBe(true),
      );
      expect(f.store.attempt(f.id).state).toBe("ACTIVE");
    } finally {
      release();
      await f.close();
    }
  },
  15000,
);

it("preserves a fully scoped authenticated native policy pause instead of recovering it", async () => {
  const f = await liveMonitoring({ renewalReceipts: true });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempt: any,
    probed = false;
  f.h.control.command = async (op, body, frame) => {
    if (op === "renew-receipted-execution-lease") {
      attempt = { ...f.store.attempt(f.id), transport: frame.transport };
      await pending;
      return attempt;
    }
    if (op === "execution-renewal-receipt") {
      probed = true;
      throw Object.assign(Error("Native instructor pause"), {
        attemptState: {
          ...attempt,
          state: "LOCKED",
          generation: attempt.generation + 1,
          reason: "administrator: Synthetic intentional pause",
        },
      });
    }
    return f.h.agent.call(op, body);
  };
  try {
    f.send({
      type: "heartbeat",
      confirmation: randomUUID(),
      ready: monitoringReady,
    });
    await vi.waitFor(() => expect(probed).toBe(true), { timeout: 4000 });
    await vi.waitFor(() => expect(f.store.attempt(f.id).state).toBe("LOCKED"));
    expect(f.store.attempt(f.id).reason).toBe(
      "administrator: Synthetic intentional pause",
    );
    expect(f.store.attempt(f.id).deadline).toBe(f.deadline);
    expect(f.store.db.prepare("SELECT * FROM continuations").all()).toEqual([]);
  } finally {
    release();
    await f.close();
  }
}, 15000);
