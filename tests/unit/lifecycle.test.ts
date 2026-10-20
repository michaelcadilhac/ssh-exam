import { it, expect } from "vitest";
import { Store } from "../../apps/server/src/db.js";
import { Lifecycle } from "../../apps/server/src/lifecycle.js";
import { AgentCommandDisconnectedError } from "../../apps/server/src/agent.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
it.each([
  "generation",
  "clock_revision",
  "exam",
  "username",
  "uid",
  "page_hash",
  "transport",
])("ignores a late renewal error after %s ownership changes", async (field) => {
  const dir = mkdtempSync(tmpdir() + "/stale-renewal-");
  const s = new Store(dir);
  try {
    s.db.exec(
      "INSERT INTO exams VALUES('e','{}'); INSERT INTO exams VALUES('other','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,page_hash) VALUES('a','e','alice',1001,'ACTIVE','{}',1,9999999999999,'old-page');",
    );
    const expected = s.attempt("a");
    let calls = 0;
    const life = new Lifecycle(
      s,
      {
        call: async () => {
          calls++;
          return {};
        },
      } as any,
      new Monitoring(s),
    );
    const updates: Record<string, string | number> = {
      generation: 1,
      clock_revision: 1,
      exam: "other",
      username: "other",
      uid: 1002,
      page_hash: "new-page",
    };
    if (field !== "transport")
      s.db
        .prepare(`UPDATE attempts SET ${field}=? WHERE id='a'`)
        .run(updates[field]);
    await life.renewalFailed(
      expected,
      () => field !== "transport",
      Error("late failure"),
    );
    expect(s.attempt("a").state).toBe("ACTIVE");
    expect(calls).toBe(0);
    expect(s.db.prepare("SELECT * FROM incidents").all()).toHaveLength(0);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
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
    expect(calls).toEqual(["agent", "disconnect"]);
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
it.each([true, false])(
  "audits an unconfirmed pause (disconnected=%s) without claiming an agent outage",
  async (disconnected) => {
    const dir = mkdtempSync(tmpdir() + "/pause-alert-");
    const s = new Store(dir);
    try {
      s.db.exec(
        "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline) VALUES('a','e','alice',1001,'ACTIVE','{}',1,9999999999999);",
      );
      let reject!: (error: Error) => void;
      const life = new Lifecycle(
        s,
        {
          call: () =>
            new Promise((_, fail) => {
              reject = fail;
            }),
        } as any,
        new Monitoring(s),
      );
      life.onPaused = () => {
        reject(
          disconnected
            ? new AgentCommandDisconnectedError("SSH connection ended")
            : Error("Agent command rejected: do not expose secret-details"),
        );
      };
      await life.lock("a", "Monitoring confirmation expired");
      expect(s.attempt("a").state).toBe("LOCKED");
      expect(s.attempt("a").deadline).toBe(9999999999999);
      const alerts = s.db
        .prepare("SELECT subject,body FROM outbox ORDER BY rowid")
        .all() as any[];
      expect(alerts.map((a) => a.subject)).toEqual(
        disconnected
          ? ["Exam interrupted: alice"]
          : ["Exam interrupted: alice", "Exam pause confirmation pending"],
      );
      expect(alerts[0].body).toContain("Monitoring confirmation expired");
      const audit = s.db
        .prepare(
          "SELECT detail FROM audit WHERE action='lock-acknowledgment-pending'",
        )
        .get() as any;
      expect(JSON.parse(audit.detail)).toEqual({
        generation: 1,
        cause: disconnected ? "ssh-disconnected" : "command-failed",
      });
      expect(JSON.stringify({ alerts, audit })).not.toContain("secret-details");
    } finally {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
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
    await l.reconcile("a");
    expect(s.attempt("a").state).toBe("LOCKED");
    expect(s.attempt("a").deadline).toBe(5400010);
    expect(s.attempt("a").generation).toBe(1);
    expect(calls).toEqual(["inspect-attempt"]);
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

it("delayed pause callbacks do not close an already resumed or newly authorized transport", () => {
  const dir = mkdtempSync(tmpdir() + "/stale-pause-");
  const s = new Store(dir);
  try {
    s.db.exec(
      "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,generation) VALUES('a','e','alice',1001,'ACTIVE','{}',1,9999999999999,2); INSERT INTO continuations VALUES('a',2,9999999999999,1)",
    );
    const life = new Lifecycle(s, {} as any, new Monitoring(s));
    let pauses = 0;
    life.onPaused = () => pauses++;
    life.acceptRemote(
      { state: "LOCKED", start: 1, deadline: 9999999999999, generation: 2 },
      undefined,
      "a",
    );
    expect(s.attempt("a").state).toBe("ACTIVE");
    expect(pauses).toBe(0);
    s.db.exec(
      "UPDATE attempts SET state='LOCKED'; UPDATE continuations SET consumed=0",
    );
    life.acceptRemote(
      { state: "LOCKED", start: 1, deadline: 9999999999999, generation: 2 },
      undefined,
      "a",
    );
    expect(pauses).toBe(0);
    life.acceptRemote(
      { state: "LOCKED", start: 1, deadline: 9999999999999, generation: 3 },
      undefined,
      "a",
    );
    expect(pauses).toBe(1);
    expect(s.attempt("a").generation).toBe(3);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("retains the initiating pause reason when the watchdog later locks the same generation", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-primary-reason-");
  const s = new Store(dir);
  try {
    s.db.exec(
      "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,generation,reason) VALUES('a','e','alice',1001,'LOCKED','{}',1,9999999999999,1,'Exam activation paused: fullscreen lost');",
    );
    const life = new Lifecycle(s, {} as any, new Monitoring(s));
    const remote = {
      state: "LOCKED",
      start: 1,
      deadline: 9999999999999,
      generation: 1,
      reason:
        "Monitoring authorization expired after 15 seconds without renewal",
    };
    life.acceptRemote(remote, undefined, "a");
    life.acceptRemote(remote, undefined, "a");
    expect(s.attempt("a").reason).toBe(
      "Exam activation paused: fullscreen lost",
    );
    const events = s.db
      .prepare("SELECT detail FROM audit WHERE action='agent-lock'")
      .all() as any[];
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].detail).reason).toBe(remote.reason);
    life.acceptRemote(
      {
        ...remote,
        generation: 2,
        reason: "Class server restarted; exam access paused",
      },
      undefined,
      "a",
    );
    expect(s.attempt("a").reason).toContain("Class server restarted");
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each(["NORMAL", "RESTORE_FAILED", undefined])(
  "requires explicit normal account policy before retiring a cancelled preflight: %s",
  async (policy) => {
    const dir = mkdtempSync(tmpdir() + "/exam-cancel-policy-");
    const s = new Store(dir);
    try {
      s.db.exec(
        "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('a','e','alice',1001,'CANCELLED_BEFORE_START','{}');",
      );
      const life = new Lifecycle(
        s,
        {
          call: async () => ({
            state: "CANCELLED_BEFORE_START",
            start: 0,
            account_policy_required: true,
            policy_state: policy,
          }),
        } as any,
        new Monitoring(s),
      );
      if (policy === "NORMAL") {
        await life.retirePreflight("a");
        expect(s.db.prepare("SELECT * FROM attempts").all()).toHaveLength(0);
      } else {
        await expect(life.retirePreflight("a")).rejects.toThrow(
          "account access restoration",
        );
        expect(s.attempt("a")).toBeTruthy();
      }
    } finally {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

it("keeps detailed omission reports complete and separate while deduplicating pending replays", () => {
  const dir = mkdtempSync(tmpdir() + "/detailed-alert-");
  const s = new Store(dir);
  try {
    const life = new Lifecycle(s, {} as any, new Monitoring(s));
    const subject = "Submission entries omitted: alice (e)";
    const first =
      "Student: alice\nExam: e\nAttempt: first\n" +
      "omitted entry and reason\n".repeat(600);
    const second = first.replace("Attempt: first", "Attempt: second");
    life.alert(subject, first, { coalesce: false });
    life.alert(subject, second, { coalesce: false });
    life.alert(subject, first, { coalesce: false });
    expect(
      s.db.prepare("SELECT body FROM outbox ORDER BY rowid").all(),
    ).toEqual([{ body: first }, { body: second }]);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
