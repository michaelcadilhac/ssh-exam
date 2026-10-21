import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { Lifecycle } from "../../apps/server/src/lifecycle.js";
import { ClockControl } from "../../apps/server/src/clock-control.js";
import {
  ClockManagement,
  assertClockCapabilities,
} from "../../apps/server/src/clock-management.js";
import { AttemptManagement } from "../../apps/server/src/attempt-management.js";

it("stages shared per-target intents atomically, redacts inspection and retains native clocks/holds", () => {
  const dir = mkdtempSync(tmpdir() + "/clock-management-");
  const store = new Store(dir);
  try {
    const a = randomUUID(),
      b = randomUUID(),
      c = randomUUID();
    const start = Date.now() - 60000,
      deadline = Date.now() + 3600000;
    store.db
      .prepare("INSERT INTO exams VALUES('e',?)")
      .run(JSON.stringify({ duration: 5400 }));
    const insert = store.db.prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,page_hash,start,deadline,original_deadline,access_state) VALUES(?,'e',?,?,?,?,'PRIVATE-PAGE-HASH',?,?,?,'HELD')",
    );
    insert.run(
      a,
      "alice",
      1001,
      "LOCKED",
      JSON.stringify({
        duration: 5400,
        webcam: false,
        secret: "PRIVATE-SETTINGS-KEY",
      }),
      start,
      deadline,
      deadline,
    );
    insert.run(b, "bob", 1002, "ACTIVE", "{}", start, deadline, deadline);
    insert.run(c, "carol", 1003, "COMPLETED", "{}", start, deadline, deadline);
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid,duration) VALUES('e','alice',1001,7200)",
      )
      .run();
    let io = 0;
    const agent: any = {
      connected: () => {
        io++;
        throw Error("unexpected external IO during staging");
      },
      call: () => {
        io++;
        throw Error("unexpected native call");
      },
    };
    const life = new Lifecycle(store, agent, new Monitoring(store));
    const clocks = new ClockControl(store, agent, life);
    const attempts = new AttemptManagement(store, clocks, (row) => ({
      ...row,
      connected: false,
    }));
    const management = new ClockManagement(store, clocks, attempts);
    const before = store.attempt(a);
    const targetA = {
      id: a,
      revision: 0,
      requestID: randomUUID(),
      expectedSeconds: 7200,
    };
    const targetC = {
      id: c,
      revision: 0,
      requestID: randomUUID(),
      expectedSeconds: 5400,
    };
    const batch = { exam: "e", action: "reset", targets: [targetA, targetC] };
    const result = management.batch(batch, "agent:class:root");
    expect(result.results.map((r) => r.status)).toEqual(["pending", "failed"]);
    expect(result.results[0]).toMatchObject({
      pending: {
        remaining_seconds: 7200,
        actor: "agent:class:root",
      },
    });
    expect(management.batch(batch, "agent:class:root").results[0]).toEqual(
      result.results[0],
    );
    store.db
      .prepare(
        "UPDATE enrollments SET duration=8100 WHERE exam='e' AND username='alice'",
      )
      .run();
    expect(management.batch(batch, "agent:class:root").results[0]).toEqual(
      result.results[0],
    ); // fixed issued intent, not a second reset
    expect(store.attempt(a)).toEqual(before);
    const extension = management.single(
      { id: b, revision: 0, minutes: 5, requestID: randomUUID() },
      "teacher",
      true,
    );
    expect(extension).toMatchObject({
      confirmed: false,
      status: "pending",
      pending: { remaining_seconds: 0, extend_seconds: 300, deadline },
    });
    expect(io).toBe(0);
    const reviewed = management.preview({
      exam: "e",
      targets: [{ id: c, revision: 0 }],
    });
    expect(reviewed.targets[0].expectedSeconds).toBe(5400);
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid,duration) VALUES('e','carol',1003,7200)",
      )
      .run();
    const staleDefault = management.batch(
      {
        exam: "e",
        action: "reset",
        targets: [
          {
            id: c,
            revision: 0,
            requestID: randomUUID(),
            expectedSeconds: 5400,
          },
        ],
      },
      "teacher",
    );
    expect(staleDefault.results[0]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Default allowance changed"),
    });
    const state = JSON.stringify(attempts.page({ exam: "e" }));
    expect(state).not.toContain("PRIVATE-PAGE-HASH");
    expect(state).not.toContain("PRIVATE-SETTINGS-KEY");
    expect(attempts.page({ exam: "e", limit: 1 }).next).not.toBeNull();
    expect(attempts.page({ exam: "e", view: "working" }).attempts).toEqual([]);
    expect(management.show({ id: targetA.requestID })).toMatchObject({
      confirmed: false,
      status: "pending",
    });
    const malformed = randomUUID();
    store.db
      .prepare("UPDATE attempts SET settings=? WHERE id=?")
      .run(JSON.stringify({ pad: "x".repeat(20000) }), c);
    // A post-stage projection/audit error must roll back the entire item, not
    // report failure while leaving a hidden pending request behind.
    store.db.prepare("UPDATE attempts SET state='LOCKED' WHERE id=?").run(c);
    expect(() =>
      management.single(
        { id: c, revision: 0, minutes: 10, requestID: malformed },
        "teacher",
      ),
    ).toThrow("inspection bounds");
    expect(
      store.db
        .prepare("SELECT 1 FROM clock_reset_requests WHERE id=?")
        .get(malformed),
    ).toBeUndefined();
    expect(store.db.pragma("foreign_key_check")).toEqual([]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps the shared capability guard fail-closed", () => {
  expect(() => assertClockCapabilities({}, false)).toThrow("Update");
  expect(() =>
    assertClockCapabilities(
      { capabilities: ["clock-reset", "deadline-timing-check"] },
      true,
    ),
  ).toThrow("Update");
  expect(() =>
    assertClockCapabilities(
      {
        capabilities: ["clock-reset", "deadline-timing-check", "clock-extend"],
      },
      true,
    ),
  ).not.toThrow();
});
