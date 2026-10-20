import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { createApp } from "../../apps/server/src/app.js";
import { PREFLIGHT_TIMEOUT_MS } from "../../packages/protocol/preflight.js";

it("housekeeping skips never-opened and uncertain started records, cleans real preflights, and reconciles lost activation replies across restart", async () => {
  const data = mkdtempSync(tmpdir() + "/preflight-housekeeping-");
  const config: any = {
    mode: "development",
    origin: "http://localhost:3000",
    data,
    port: 3000,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  };
  const options = {
    logStream: new Writable({
      write(_c, _e, cb) {
        cb();
      },
    }),
  };
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  let fixture = await createApp(config, options);
  const old = Date.now() - PREFLIGHT_TIMEOUT_MS - 1000;
  const committed = Date.now() - 10000,
    deadline = committed + 5400000;
  const calls: string[] = [];
  const install = () =>
    vi
      .spyOn(fixture.life.agent, "call")
      .mockImplementation(async (op, body) => {
        calls.push(`${op}:${body.id}`);
        if (body.id === "lost" && op === "cancel-attempt")
          throw Error("cannot cancel started attempt");
        return {
          id: body.id,
          exam: "e",
          username: body.id,
          uid: body.id === "lost" ? 1004 : body.id === "legacy" ? 1003 : 1002,
          state: body.id === "lost" ? "ACTIVE" : "CANCELLED_BEFORE_START",
          start: body.id === "lost" ? committed : 0,
          ...(body.id === "lost"
            ? { deadline, original_deadline: deadline }
            : {}),
          policy_state: "NORMAL",
        };
      });
  try {
    fixture.store.db.exec("INSERT INTO exams VALUES('e','{}')");
    const insert = fixture.store.db.prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,preflight_started_at,last_contact,start) VALUES(?,'e',?,?,'PREPARING','{}',?,?,?)",
    );
    insert.run("unused", "unused", 1001, null, null, null);
    insert.run("real", "real", 1002, old, Date.now(), null);
    insert.run("legacy", "legacy", 1003, null, old, null);
    insert.run("lost", "lost", 1004, old, old, null);
    insert.run("uncertain", "uncertain", 1005, old, old, committed);
    install();
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls).not.toContain("cancel-attempt:unused");
    expect(calls).not.toContain("cancel-attempt:uncertain");
    expect(fixture.store.attempt("real").state).toBe("CANCELLED_BEFORE_START");
    expect(fixture.store.attempt("legacy").state).toBe(
      "CANCELLED_BEFORE_START",
    );
    expect(fixture.store.attempt("lost")).toMatchObject({
      state: "LOCKED",
      start: committed,
      deadline,
      original_deadline: deadline,
    });
    expect(fixture.store.db.prepare("SELECT * FROM outbox").all()).toHaveLength(
      0,
    );
    await fixture.app.close();
    fixture = await createApp(config, options);
    install();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fixture.store.attempt("unused")).toMatchObject({
      state: "PREPARING",
      start: null,
      deadline: null,
    });
    expect(calls).not.toContain("cancel-attempt:unused");
    expect(fixture.store.attempt("uncertain").start).toBe(committed);
  } finally {
    await fixture.app.close();
    vi.useRealTimers();
    rmSync(data, { recursive: true, force: true });
  }
});
