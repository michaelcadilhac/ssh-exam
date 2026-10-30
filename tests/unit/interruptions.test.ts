import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";
import { Lifecycle } from "../../apps/server/src/lifecycle.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import {
  interruptionSeconds,
  authorizationStatus,
} from "../../packages/protocol/interruptions.js";
function fixture() {
  const dir = mkdtempSync(tmpdir() + "/interruptions-");
  let store = new Store(dir);
  store.db.exec(
    "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline) VALUES('a','e','alice',1001,'ACTIVE','{}',1000,100000,100000)",
  );
  const life = new Lifecycle(
    store,
    {
      call: async (_op: string, body: any) => ({
        generation: body?.generation,
      }),
    } as any,
    new Monitoring(store),
  );
  return {
    store,
    life,
    dir,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
it("records contiguous pauses, all reasons, revoked approvals and actual resume/end durations across restart", async () => {
  const t = fixture(),
    time = vi.spyOn(Date, "now").mockReturnValue(10000);
  try {
    await t.life.lock("a", "Fullscreen exited");
    time.mockReturnValue(15000);
    await t.life.lock("a", "Screen sharing stopped");
    await t.life.lock("a", "Screen sharing stopped");
    let entries = t.store.interruptions.list("a");
    expect(entries).toHaveLength(1);
    expect(entries[0].events.map((e) => e.reason)).toEqual([
      "Fullscreen exited",
      "Screen sharing stopped",
    ]);
    time.mockReturnValue(20000);
    t.store.db
      .prepare("INSERT INTO continuations VALUES(?,?,?,0)")
      .run("a", 1, 90000);
    t.store.interruptions.authorize(t.store.attempt("a"), "teacher", 90000);
    time.mockReturnValue(21000);
    await t.life.lock("a", "Another policy violation");
    entries = t.store.interruptions.list("a");
    expect(entries).toHaveLength(1);
    expect(entries[0].authorizations[0].revoked_at).toBe(21000);
    expect(entries[0].generation).toBe(2);
    time.mockReturnValue(22000);
    t.store.interruptions.authorize(t.store.attempt("a"), "teacher", 90000);
    expect(
      interruptionSeconds(
        t.store.interruptions.list("a")[0],
        t.store.attempt("a"),
        30000,
      ),
    ).toBe(20);
    t.store.db
      .prepare("INSERT OR REPLACE INTO continuations VALUES(?,?,?,0)")
      .run("a", 2, 90000);
    time.mockReturnValue(40000);
    t.life.confirmContinuation("a", 2);
    entries = t.store.interruptions.list("a");
    expect(entries[0]).toMatchObject({
      opened: 10000,
      ended: 40000,
      outcome: "resumed",
    });
    expect(entries[0].authorizations[1].used_at).toBe(40000);
    expect(interruptionSeconds(entries[0], t.store.attempt("a"), 999999)).toBe(
      30,
    );
    time.mockReturnValue(50000);
    await t.life.lock("a", "Network disconnected");
    const a = {
      ...t.store.attempt("a"),
      ended: 70000,
      state: "COMPLETED",
    } as any;
    t.store.db
      .prepare("UPDATE attempts SET state='COMPLETED',ended=70000 WHERE id='a'")
      .run();
    t.store.interruptions.end(a);
    entries = t.store.interruptions.list("a");
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      opened: 50000,
      ended: 70000,
      outcome: "attempt-ended",
    });
    expect(interruptionSeconds(entries[1], a, 999999)).toBe(20);
    expect(t.store.attempt("a").original_deadline).toBe(100000);
    t.store.close();
    const reopened = new Store(t.dir);
    expect(reopened.interruptions.list("a")).toEqual(entries);
    reopened.close();
  } finally {
    time.mockRestore();
    t.close();
  }
});
it("reports approval separately from resumption, including expiration and automatic sandbox authorization", () => {
  const t = fixture(),
    time = vi.spyOn(Date, "now").mockReturnValue(10000);
  try {
    t.store.db.prepare("UPDATE attempts SET state='LOCKED' WHERE id='a'").run();
    const a = t.store.attempt("a");
    t.store.interruptions.pause(a, "Lost focus");
    t.store.interruptions.authorize(a, "sandbox", 20000, true);
    let e = t.store.interruptions.list("a")[0];
    expect(e.outcome).toBeNull();
    expect(e.ended).toBeNull();
    expect(authorizationStatus(e.authorizations[0], 15000)).toBe(
      "Awaiting resume",
    );
    expect(authorizationStatus(e.authorizations[0], 20000)).toBe(
      "Expired without resuming",
    );
    expect(interruptionSeconds(e, a, 150000)).toBe(90);
    time.mockReturnValue(30000);
    t.store.interruptions.authorize(a, "teacher", 50000);
    e = t.store.interruptions.list("a")[0];
    expect(authorizationStatus(e.authorizations[0], 30000)).toBe(
      "Expired without resuming",
    );
    expect(e.authorizations[1].actor).toBe("teacher");
    time.mockReturnValue(31000);
    t.store.interruptions.authorize(a, "teacher", 90000);
    e = t.store.interruptions.list("a")[0];
    expect(e.authorizations[1].replaced_at).toBe(31000);
    expect(authorizationStatus(e.authorizations[1], 31000)).toBe(
      "Replaced",
    );

    expect(
      interruptionSeconds({ opened: null, outcome: "historical" }, a, 99999),
    ).toBeNull();
  } finally {
    time.mockRestore();
    t.close();
  }
});
it("deletion erases interruption monitoring and cannot be resurrected by late pause reports", () => {
  const t = fixture();
  try {
    t.store.db.prepare("UPDATE attempts SET state='LOCKED' WHERE id='a'").run();
    const a = t.store.attempt("a");
    t.store.interruptions.pause(a, "Focus lost");
    new Monitoring(t.store).delete("a", "teacher");
    t.store.interruptions.pause(a, "Late agent message");
    expect(t.store.interruptions.list("a")).toEqual([]);
  } finally {
    t.close();
  }
});
it("migrates legacy reasons and dated approvals without inventing historical resume times", () => {
  const t = fixture();
  try {
    t.store.db
      .prepare("UPDATE attempts SET state='LOCKED',generation=2 WHERE id='a'")
      .run();
    t.store.db.exec(
      "INSERT INTO incidents(id,attempt,generation,opened,events) VALUES('i1','a',1,10000,'[{\"at\":10000,\"reason\":\"Focus lost\"}]'); INSERT INTO incidents(id,attempt,generation,opened,events) VALUES('i2','a',2,30000,'[{\"at\":30000,\"reason\":\"Screen lost\"}]');",
    );
    t.store.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?)")
      .run("audit", 15000, "teacher", "authorize-continuation", "a", "");
    t.store.db.exec(
      "DROP TABLE attempt_interruptions; DELETE FROM schema_version WHERE version=11",
    );
    t.store.close();
    const reopened = new Store(t.dir);
    try {
      const entries = reopened.interruptions.list("a");
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({
        outcome: "historical",
        ended: null,
        historical: true,
      });
      expect(entries[0].authorizations[0]).toMatchObject({
        actor: "teacher",
        at: 15000,
        historical: true,
      });
      expect(entries[1]).toMatchObject({ outcome: null, opened: 30000 });
      expect(
        interruptionSeconds(entries[0], reopened.attempt("a"), 99999),
      ).toBeNull();
      new Monitoring(reopened).delete("a", "teacher");
      reopened.db.exec(
        "DELETE FROM schema_version WHERE version=11; DROP TABLE attempt_interruptions",
      );
    } finally {
      reopened.close();
    }
    const again = new Store(t.dir);
    expect(again.interruptions.list("a")).toEqual([]);
    again.close();
  } finally {
    t.close();
  }
});

it("legacy repeated approvals attribute consumption only to the last matching grant", () => {
  const t = fixture();
  try {
    t.store.db.exec(
      "INSERT INTO incidents(id,attempt,generation,opened,events) VALUES('i','a',1,10000,'[]'); INSERT INTO continuations VALUES('a',1,90000,1);",
    );
    for (const [id, at] of [
      ["first", 15000],
      ["last", 20000],
    ] as const)
      t.store.db
        .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?)")
        .run(id, at, "teacher", "authorize-continuation", "a", "");
    t.store.db.exec(
      "DROP TABLE attempt_interruptions; DELETE FROM schema_version WHERE version=11",
    );
    t.store.close();
    const s = new Store(t.dir);
    try {
      const grants = s.interruptions.list("a")[0].authorizations;
      expect(grants).toHaveLength(2);
      expect(grants[0].consumed).not.toBe(true);
      expect(grants[0].expires).toBeNull();
      expect(grants[1].consumed).toBe(true);
      expect(grants[1].expires).toBe(90000);
    } finally {
      s.close();
    }
  } finally {
    t.close();
  }
});
it("restart recovers a missing pause time honestly and closes a partially committed exam end", () => {
  const t = fixture();
  try {
    t.store.db.exec(
      "UPDATE attempts SET state='LOCKED',reason='Pause persisted before history' WHERE id='a'",
    );
    t.store.close();
    let s = new Store(t.dir);
    try {
      let entry = s.interruptions.list("a")[0];
      expect(entry).toMatchObject({
        opened: null,
        outcome: null,
        historical: true,
      });
      expect(interruptionSeconds(entry, s.attempt("a"), 50000)).toBeNull();
      s.db
        .prepare("DELETE FROM attempt_interruptions WHERE attempt=?")
        .run("a");
      s.interruptions.pause(s.attempt("a"), "Focus lost", 10000);
      s.db.exec(
        "UPDATE attempts SET state='COMPLETED',ended=20000 WHERE id='a'",
      );
      s.close();
      s = new Store(t.dir);
      entry = s.interruptions.list("a")[0];
      expect(entry).toMatchObject({
        opened: 10000,
        ended: 20000,
        outcome: "attempt-ended",
      });
      expect(interruptionSeconds(entry, s.attempt("a"), 99999)).toBe(10);
    } finally {
      s.close();
    }
  } finally {
    t.close();
  }
});

it("a superseded or expired approval cannot mark a pause resumed after the SSH reply", () => {
  const t = fixture(),
    clock = vi.spyOn(Date, "now").mockReturnValue(20000);
  try {
    for (const change of [
      "generation=2",
      "state='FINALIZING'",
      "deadline=20000",
    ]) {
      t.store.db.exec(
        "UPDATE attempts SET state='LOCKED',generation=1,deadline=100000 WHERE id='a'; DELETE FROM attempt_interruptions; INSERT OR REPLACE INTO continuations VALUES('a',1,90000,0)",
      );
      t.store.interruptions.pause(t.store.attempt("a"), "Paused", 10000);
      t.store.interruptions.authorize(t.store.attempt("a"), "teacher", 90000);
      t.store.db.exec(`UPDATE attempts SET ${change} WHERE id='a'`);
      expect(() => t.life.confirmContinuation("a", 1)).toThrow(
        "authorization changed",
      );
      expect(t.store.interruptions.list("a")[0].ended).toBeNull();
      expect(
        t.store.db
          .prepare("SELECT consumed FROM continuations WHERE attempt='a'")
          .get(),
      ).toEqual({ consumed: 0 });
    }
    t.store.db.exec(
      "UPDATE attempts SET state='LOCKED',generation=1,deadline=100000 WHERE id='a'; UPDATE continuations SET expires=20000 WHERE attempt='a'",
    );
    expect(() => t.life.confirmContinuation("a", 1)).toThrow(
      "authorization changed",
    );
  } finally {
    clock.mockRestore();
    t.close();
  }
});

it("the database retention trigger also erases history for older server deletion paths", () => {
  const t = fixture();
  try {
    t.store.db.exec("UPDATE attempts SET state='LOCKED' WHERE id='a'");
    t.store.interruptions.pause(t.store.attempt("a"), "Focus lost");
    t.store.db
      .prepare("INSERT OR REPLACE INTO tombstones VALUES(?,?)")
      .run("a", Date.now());
    expect(
      t.store.db.prepare("SELECT count(*) n FROM attempt_interruptions").get(),
    ).toEqual({ n: 0 });
  } finally {
    t.close();
  }
});
