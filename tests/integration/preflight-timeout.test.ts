import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { Agent } from "../../apps/server/src/agent.js";
import { hash } from "../../apps/server/src/db.js";
import {
  PREFLIGHT_TIMEOUT_MS,
  PREFLIGHT_EXPIRED_REASON,
  preflightExpired,
} from "../../packages/protocol/preflight.js";

it("uses elapsed preparation time, independent of heartbeats, and excludes started exams", () => {
  const a = { state: "PREPARING", start: null, preflight_started_at: 1000 };
  expect(preflightExpired(a, 1000 + PREFLIGHT_TIMEOUT_MS - 1)).toBe(false);
  expect(preflightExpired(a, 1000 + PREFLIGHT_TIMEOUT_MS)).toBe(true);
  expect(preflightExpired({ ...a, state: "ACTIVE", start: 1001 }, 999999)).toBe(
    false,
  );
  expect(preflightExpired({ ...a, preflight_started_at: null }, 999999)).toBe(
    false,
  );
});

it("blocks expired Begin/practice synchronously, preserves fresh contact, and allows retiring for a new login", async () => {
  const dir = mkdtempSync(tmpdir() + "/preflight-limit-");
  const remotes: Record<string, any> = {};
  const agent = vi
    .spyOn(Agent.prototype, "call")
    .mockImplementation(async (op, body) => {
      const a = remotes[body.id];
      if (op === "cancel-attempt")
        Object.assign(a, {
          state: "CANCELLED_BEFORE_START",
          reason: body.reason,
          ended: Date.now(),
        });
      return { ...a };
    });
  const { app, store, life } = await createApp({
    mode: "development",
    origin: "http://localhost:3000",
    data: dir,
    port: 3000,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  });
  try {
    store.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
    const s = store.session("student", "alice", "e");
    const headers = {
      cookie: `session=${s.token}`,
      origin: "http://localhost:3000",
      "x-csrf-token": s.csrf,
      "x-page-instance": "page",
    };
    for (const action of ["begin", "practice"]) {
      const id = action;
      store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,page_hash,preflight_started_at,last_contact) VALUES(?,'e','alice',1001,'PREPARING','{}',?,?,?)",
        )
        .run(
          id,
          hash("page"),
          Date.now() - PREFLIGHT_TIMEOUT_MS - 1000,
          Date.now(),
        );
      remotes[id] = {
        id,
        exam: "e",
        username: "alice",
        uid: 1001,
        state: "PREPARING",
        start: 0,
      };
      const result = await app.inject({
        method: "POST",
        url: `/api/student/attempts/${id}/${action}`,
        headers,
        payload: {},
      });
      expect(result.json().error).toBe(PREFLIGHT_EXPIRED_REASON);
      expect(store.attempt(id)).toMatchObject({
        state: "CANCELLED_BEFORE_START",
        start: null,
        deadline: null,
        reason: PREFLIGHT_EXPIRED_REASON,
      });
      await life.retirePreflight(id);
      expect(
        store.db.prepare("SELECT 1 FROM attempts WHERE id=?").get(id),
      ).toBeUndefined();
    }
    expect(agent.mock.calls.some(([op]) => op === "activate-attempt")).toBe(
      false,
    );
    expect(store.db.prepare("SELECT * FROM outbox").all()).toHaveLength(0);
  } finally {
    await app.close();
    agent.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
