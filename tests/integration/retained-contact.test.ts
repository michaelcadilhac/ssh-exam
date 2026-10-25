import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { liveMonitoring } from "../fixtures/live-monitoring.js";

// Real authenticated HTTP/WebSocket/SSH, simulated native execution. The real
// negotiated-v1 browser case covers mode admission; these isolate both server
// contact-timeout callers without pretending contact grants native permission.
it.each(["legacy", "v1"])(
  "%s contact sweep preserves its defined policy without changing time",
  async (mode) => {
    const f = await liveMonitoring({ ownedAttempt: true });
    try {
      f.h.control.command = async () => ({});
      f.store.db
        .prepare(
          "UPDATE attempts SET monitoring_mode=?,last_contact=? WHERE id=?",
        )
        .run(mode, Date.now() - 20000, f.id);
      const before = f.store.attempt(f.id);
      await f.life.tick();
      const after = f.store.attempt(f.id);
      expect(after.state).toBe(mode === "v1" ? "ACTIVE" : "LOCKED");
      expect(after.deadline).toBe(before.deadline);
      expect(after.original_deadline).toBe(before.original_deadline);
      expect(after.generation).toBe(
        before.generation + (mode === "v1" ? 0 : 1),
      );
      expect(f.store.db.prepare("SELECT * FROM incidents").all()).toHaveLength(
        mode === "v1" ? 0 : 1,
      );
      if (mode === "v1") {
        expect(f.connection.alive).toBe(true);
        // Genuine focus-policy expiry remains authoritative despite fresh
        // native mode; only coordination uncertainty lost its violation path.
        f.store.db
          .prepare("UPDATE attempts SET focus_lost_at=? WHERE id=?")
          .run(Date.now() - 21000, f.id);
        await f.life.tick();
        expect(f.store.attempt(f.id)).toMatchObject({
          state: "LOCKED",
          deadline: before.deadline,
          generation: before.generation + 1,
        });
        expect(f.store.attempt(f.id).reason).toContain("focus");
      }
      f.store.db
        .prepare("UPDATE attempts SET deadline=? WHERE id=?")
        .run(Date.now() - 1, f.id);
      await f.life.tick();
      expect(f.store.attempt(f.id)).toMatchObject({
        state: "FINALIZING",
        reason: "expiration",
        original_deadline: before.original_deadline,
      });
    } finally {
      await f.close();
    }
  },
  10000,
);

it.each(["legacy", "v1"])(
  "%s fresh page bind after a contact gap preserves its defined policy and SSH identity",
  async (mode) => {
    const f = await liveMonitoring({ ownedAttempt: true });
    let socket: WebSocket | undefined;
    try {
      // Isolate the actual bind route from the separately tested periodic sweep.
      f.life.tick = async () => {};
      f.h.control.command = async () => ({});
      const closed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Old session close missing")),
          2000,
        );
        f.ws.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      f.ws.close();
      await closed;
      f.store.db
        .prepare(
          "UPDATE attempts SET monitoring_mode=?,last_contact=? WHERE id=?",
        )
        .run(mode, Date.now() - 20000, f.id);
      const before = f.store.attempt(f.id),
        counts = { ...f.h.authCalls };
      socket = new WebSocket(
        f.headers.origin.replace("http:", "ws:") + "/api/student/session",
        {
          headers: { origin: f.headers.origin, cookie: f.headers.cookie },
          handshakeTimeout: 2000,
        },
      );
      const current = socket,
        binding = randomUUID();
      const reply = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Fresh bind reply missing")),
          2000,
        );
        current.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        current.on("message", (raw) => {
          const message = JSON.parse(String(raw));
          if (message.type === "error") {
            clearTimeout(timer);
            reject(Error(message.error));
          }
          if (message.binding === binding) {
            clearTimeout(timer);
            resolve(message);
          }
        });
        current.once("open", () =>
          current.send(
            JSON.stringify({
              v: 1,
              type: "bind",
              attempt: f.id,
              page: f.page,
              binding,
            }),
          ),
        );
      });
      expect(reply.attempt).toMatchObject({
        id: f.id,
        state: mode === "v1" ? "ACTIVE" : "LOCKED",
        generation: before.generation + (mode === "v1" ? 0 : 1),
        start: before.start,
        deadline: before.deadline,
        original_deadline: before.original_deadline,
      });
      expect(f.h.authCalls).toEqual(counts);
      if (mode === "v1") {
        expect(f.connection.alive).toBe(true);
        expect(f.store.db.prepare("SELECT * FROM incidents").all()).toEqual([]);
      }
    } finally {
      socket?.terminate();
      await f.close();
    }
  },
  10000,
);
