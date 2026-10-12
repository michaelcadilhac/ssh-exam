import { it, expect } from "vitest";
import { Store } from "../../apps/server/src/db.js";
import { Lifecycle } from "../../apps/server/src/lifecycle.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
it("announces pause and disconnects before waiting for the class agent", async () => {
  const dir = mkdtempSync(tmpdir() + "/pause-disconnect-");
  const s = new Store(dir);
  try {
    s.db.exec(
      "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline) VALUES('a','e','alice',1001,'ACTIVE','{}',1,9999999999999);",
    );
    const calls: string[] = [];
    const life = new Lifecycle(
      s,
      {
        call: async () => {
          calls.push("agent");
          return { generation: 1 };
        },
      } as any,
      new Monitoring(s),
    );
    life.onPaused = (a) => {
      expect(a.state).toBe("LOCKED");
      calls.push("disconnect");
    };
    await life.lock("a", "focus lost");
    expect(calls).toEqual(["disconnect", "agent"]);
    expect(s.attempt("a").deadline).toBe(9999999999999);
    expect(
      s.db
        .prepare(
          "SELECT action FROM audit WHERE action='reauthentication-required'",
        )
        .get(),
    ).toBeTruthy();
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("reconciles a lost activation acknowledgment into a lock with the original deadline", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-reconcile-");
  const s = new Store(dir);
  try {
    s.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
    s.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('a','e','alice',1001,'PREPARING','{}')",
      )
      .run();
    const calls: string[] = [];
    const remote = {
      state: "ACTIVE",
      start: 10,
      deadline: 5400010,
      work_path: "/work",
    };
    const agent = {
      call: async (op: string) => {
        calls.push(op);
        return remote;
      },
    };
    const l = new Lifecycle(s, agent as any, new Monitoring(s));
    await l.tick();
    expect(s.attempt("a").state).toBe("LOCKED");
    expect(s.attempt("a").deadline).toBe(5400010);
    expect(s.attempt("a").generation).toBe(1);
    expect(calls).toContain("lock-attempt");
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("new incident revokes a pending continuation generation", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-grant-");
  const s = new Store(dir);
  try {
    s.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
    s.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,deadline,generation) VALUES('a','e','alice',1001,'LOCKED','{}',?,1)",
      )
      .run(Date.now() + 5400000);
    s.db
      .prepare("INSERT INTO continuations VALUES(?,?,?,0)")
      .run("a", 1, Date.now() + 300000);
    let generation = 0;
    const l = new Lifecycle(
      s,
      {
        call: async (_op: string, b: any) => {
          generation = b.generation;
        },
      } as any,
      new Monitoring(s),
    );
    await l.lock("a", "New policy event");
    expect(s.attempt("a").generation).toBe(2);
    expect(generation).toBe(2);
    expect(
      s.db.prepare("SELECT 1 FROM continuations WHERE attempt='a'").get(),
    ).toBeUndefined();
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("reconciles a newer local lock generation without extending time or retaining approval", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-local-generation-");
  const s = new Store(dir);
  try {
    s.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
    const deadline = Date.now() + 5400000;
    s.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,deadline,generation) VALUES('a','e','alice',1001,'LOCKED','{}',?,1)",
      )
      .run(deadline);
    s.db
      .prepare("INSERT INTO continuations VALUES(?,?,?,0)")
      .run("a", 1, Date.now() + 300000);
    const life = new Lifecycle(
      s,
      { call: async () => ({ state: "LOCKED", generation: 3 }) } as any,
      new Monitoring(s),
    );
    await life.reconcile("a");
    expect(s.attempt("a").generation).toBe(3);
    expect(s.attempt("a").deadline).toBe(deadline);
    expect(
      s.db.prepare("SELECT 1 FROM continuations WHERE attempt='a'").get(),
    ).toBeUndefined();
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each(["PREPARING", "CANCELLED_BEFORE_START"])(
  "refuses collection of %s without changing it into a collection failure",
  async (state) => {
    const dir = mkdtempSync(tmpdir() + "/exam-unstarted-");
    const s = new Store(dir);
    try {
      s.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
      s.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('a','e','alice',1001,?,'{}')",
        )
        .run(state);
      let calls = 0;
      const life = new Lifecycle(
        s,
        {
          call: async () => {
            calls++;
          },
        } as any,
        new Monitoring(s),
      );
      await expect(life.finish("a", "student finish")).rejects.toThrow(
        "has not started",
      );
      expect(s.attempt("a").state).toBe(state);
      expect(calls).toBe(0);
      expect(s.db.prepare("SELECT * FROM outbox").all()).toHaveLength(0);
    } finally {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

it("cancels and retires only confirmed unstarted preparations, retaining audit and deletion tombstones", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-cancel-");
  const s = new Store(dir);
  try {
    s.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
    s.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('a','e','alice',1001,'PREPARING','{}')",
      )
      .run();
    const remote = { state: "PREPARING", start: 0 };
    const life = new Lifecycle(
      s,
      {
        call: async (op: string) => {
          if (op === "cancel-attempt") remote.state = "CANCELLED_BEFORE_START";
          return remote;
        },
      } as any,
      new Monitoring(s),
    );
    await life.cancelPreflight("a", "Preflight expired");
    expect(s.attempt("a").state).toBe("CANCELLED_BEFORE_START");
    expect(s.attempt("a").start).toBeNull();
    expect(s.attempt("a").reason).toBe("Preflight expired");
    await life.retirePreflight("a");
    expect(s.db.prepare("SELECT * FROM attempts").all()).toHaveLength(0);
    expect(
      s.db.prepare("SELECT * FROM tombstones WHERE attempt='a'").get(),
    ).toBeTruthy();
    expect(
      s.db.prepare("SELECT * FROM audit WHERE action='retire-preflight'").get(),
    ).toBeTruthy();
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("never retries a cancellation when activation committed remotely", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-cancel-race-");
  const s = new Store(dir);
  try {
    s.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
    s.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('a','e','alice',1001,'CANCELLED_BEFORE_START','{}')",
      )
      .run();
    const deadline = Date.now() + 5400000;
    const life = new Lifecycle(
      s,
      {
        call: async () => ({
          state: "ACTIVE",
          start: Date.now(),
          deadline,
          work_path: "/work",
        }),
      } as any,
      new Monitoring(s),
    );
    await expect(life.retirePreflight("a")).rejects.toThrow("start status");
    expect(s.attempt("a").state).toBe("LOCKED");
    expect(s.attempt("a").deadline).toBe(deadline);
    expect(s.db.prepare("SELECT * FROM tombstones").all()).toHaveLength(0);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
