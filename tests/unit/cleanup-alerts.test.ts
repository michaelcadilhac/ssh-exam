import { it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";
import {
  Lifecycle,
  PREFLIGHT_CONFIRMATION_GRACE_MS,
} from "../../apps/server/src/lifecycle.js";
import { PREFLIGHT_TIMEOUT_MS } from "../../packages/protocol/preflight.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { AgentCommandDisconnectedError } from "../../apps/server/src/agent.js";
function fixture(state = "PREPARING") {
  const dir = mkdtempSync(tmpdir() + "/cleanup-alerts-");
  const store = new Store(dir);
  store.db.prepare("INSERT INTO exams VALUES('exam','{}')").run();
  store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('attempt','exam','alice',1001,?,'{}')",
    )
    .run(state);
  const remote: any = {
    id: "attempt",
    username: "alice",
    uid: 1001,
    exam: "exam",
    work_path: "/work",
    state,
    start: 0,
  };
  let failure: Error | undefined;
  let inspectFailure = false;
  const agent = {
    call: async (op: string) => {
      if (op === "cancel-attempt" && failure) throw failure;
      if (op === "inspect-attempt" && inspectFailure)
        throw new AgentCommandDisconnectedError("SSH connection ended");
      if (op === "cancel-attempt") remote.state = "CANCELLED_BEFORE_START";
      return { ...remote };
    },
  };
  const life = new Lifecycle(store, agent as any, new Monitoring(store));
  const log = vi.fn();
  life.onPreflightFailure = log;
  return {
    store,
    remote,
    life,
    log,
    fail: (error: Error, inspect = false) => {
      failure = error;
      inspectFailure = inspect;
    },
    alerts: () =>
      store.db.prepare("SELECT subject,body FROM outbox").all() as any[],
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
it("reports the real disconnected preflight stage, contextual email and one audit/log/alert across retries", async () => {
  const t = fixture();
  try {
    t.fail(new AgentCommandDisconnectedError("SSH connection ended"), true);
    for (let i = 0; i < 3; i++)
      await expect(
        t.life.cancelPreflight("attempt", "signed out"),
      ).rejects.toThrow("SSH connection ended");
    expect(t.log).toHaveBeenCalledOnce();
    expect(t.log.mock.calls[0][0]).toMatchObject({
      username: "alice",
      exam: "exam",
      attempt: "attempt",
      stage: "cancel-attempt",
      cause: "ssh-disconnected",
      reason: "SSH connection ended",
    });
    expect(t.alerts()).toHaveLength(1);
    expect(t.alerts()[0]).toMatchObject({
      subject: "Preflight cleanup pending: alice (exam)",
    });
    expect(t.alerts()[0].body).toContain(
      "Student: alice\nExam: exam\nAttempt: attempt",
    );
    expect(t.alerts()[0].body).toContain(
      "watchdog expires and cleans up unstarted preflights locally",
    );
    expect(t.alerts()[0].body).toContain("Signing in again is not required");
    const scheduled = t.store.db
      .prepare("SELECT id,next FROM outbox")
      .get() as { id: string; next: number };
    expect(scheduled.next).toBeGreaterThan(Date.now() + PREFLIGHT_TIMEOUT_MS);
    expect(t.life.preparePreflightNotification(scheduled.id)).toBe(false);
    expect(t.alerts()[0].body).not.toContain("class agent unavailable");
    expect(
      t.store.db
        .prepare(
          "SELECT detail FROM audit WHERE action='preflight-cleanup-failed'",
        )
        .all(),
    ).toHaveLength(1);
    expect(t.store.attempt("attempt").state).toBe("PREPARING");
  } finally {
    t.close();
  }
});
it("logs the actual native cancellation rejection without losing its cause", async () => {
  const t = fixture();
  try {
    t.fail(
      Error("protected archive exists, but workload termination unconfirmed"),
    );
    await expect(t.life.cancelPreflight("attempt", "expired")).rejects.toThrow(
      "termination unconfirmed",
    );
    expect(t.log.mock.calls[0][0]).toMatchObject({
      reason: "protected archive exists, but workload termination unconfirmed",
      cause: "command-failed",
    });
    expect(t.alerts()[0].body).toContain("workload termination unconfirmed");
  } finally {
    t.close();
  }
});
it("distinguishes confirmation failure from cancellation failure", async () => {
  const t = fixture();
  try {
    t.fail(undefined as any, true);
    await expect(
      t.life.cancelPreflight("attempt", "expired"),
    ).rejects.toThrow();
    expect(t.log.mock.calls[0][0].stage).toBe("confirm-cancellation");
  } finally {
    t.close();
  }
});
it("a lost reply followed by confirmed cancellation does not send a pending-cleanup email", async () => {
  const t = fixture();
  try {
    t.fail(new AgentCommandDisconnectedError("SSH connection ended"));
    t.remote.state = "CANCELLED_BEFORE_START";
    await t.life.cancelPreflight("attempt", "signed out");
    expect(t.store.attempt("attempt").state).toBe("CANCELLED_BEFORE_START");
    expect(t.log.mock.calls[0][0].outcome).toBe("cancellation-confirmed");
    expect(t.alerts()).toHaveLength(0);
  } finally {
    t.close();
  }
});

it("suppresses the expiry-race warning when a signed cancellation arrives during the grace window", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const t = fixture();
  try {
    t.store.db
      .prepare("UPDATE attempts SET preflight_started_at=? WHERE id='attempt'")
      .run(Date.now() - PREFLIGHT_TIMEOUT_MS);
    t.fail(new AgentCommandDisconnectedError("SSH connection ended"), true);
    await expect(
      t.life.cancelPreflight("attempt", "expired"),
    ).rejects.toThrow();
    const notice = t.store.db
      .prepare("SELECT id,next,status FROM outbox")
      .get() as any;
    expect(notice.next).toBe(Date.now() + PREFLIGHT_CONFIRMATION_GRACE_MS);
    expect(t.life.preparePreflightNotification(notice.id)).toBe(false);
    vi.setSystemTime(Date.now() + 3000);
    t.life.acceptRemote({
      ...t.remote,
      state: "CANCELLED_BEFORE_START",
      ended: Date.now(),
      policy_state: "NORMAL",
    });
    vi.setSystemTime(notice.next + 1000);
    expect(t.life.preparePreflightNotification(notice.id)).toBe(false);
    expect(
      t.store.db.prepare("SELECT status FROM outbox WHERE id=?").get(notice.id),
    ).toEqual({ status: "cancelled" });
    expect(t.store.attempt("attempt")).toMatchObject({
      state: "CANCELLED_BEFORE_START",
      start: null,
      deadline: null,
    });
  } finally {
    t.close();
    vi.useRealTimers();
  }
});

it("waits for local expiry after early logout, persists across restart, and never moves the warning on retries", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const t = fixture();
  let reopened: Store | undefined;
  try {
    const opened = Date.now();
    t.store.db
      .prepare("UPDATE attempts SET preflight_started_at=? WHERE id='attempt'")
      .run(opened);
    t.fail(new AgentCommandDisconnectedError("SSH connection ended"), true);
    await expect(
      t.life.cancelPreflight("attempt", "signed out"),
    ).rejects.toThrow();
    const notice = t.store.db
      .prepare("SELECT id,next FROM outbox")
      .get() as any;
    expect(notice.next).toBe(
      opened + PREFLIGHT_TIMEOUT_MS + PREFLIGHT_CONFIRMATION_GRACE_MS,
    );
    vi.setSystemTime(opened + 5 * 60000);
    await expect(
      t.life.cancelPreflight("attempt", "signed out"),
    ).rejects.toThrow();
    expect(
      t.store.db.prepare("SELECT next FROM outbox WHERE id=?").get(notice.id),
    ).toEqual({ next: notice.next });
    reopened = new Store(t.store.dir);
    const restarted = new Lifecycle(
      reopened,
      t.life.agent,
      new Monitoring(reopened),
    );
    expect(restarted.preparePreflightNotification(notice.id)).toBe(false);
    vi.setSystemTime(notice.next);
    expect(restarted.preparePreflightNotification(notice.id)).toBe(true);
    expect(
      reopened.db.prepare("SELECT count(*) AS n FROM outbox").get(),
    ).toEqual({ n: 1 });
    expect(reopened.attempt("attempt").state).toBe("PREPARING"); // No invented success.
    expect(t.alerts()[0].body).toContain(
      "two-minute confirmation grace period",
    );
  } finally {
    reopened?.close();
    t.close();
    vi.useRealTimers();
  }
});

it("treats a command timeout as uncertain delivery and cancels the delayed warning after confirmation", async () => {
  const t = fixture();
  try {
    t.fail(Error("SSH agent command timed out; await status callback"), true);
    await expect(
      t.life.cancelPreflight("attempt", "expired"),
    ).rejects.toThrow();
    const notice = t.store.db
      .prepare("SELECT id,next FROM outbox")
      .get() as any;
    expect(notice.next).toBeGreaterThan(Date.now());
    t.life.acceptRemote({ ...t.remote, state: "CANCELLED_BEFORE_START" });
    expect(t.life.preparePreflightNotification(notice.id)).toBe(false);
  } finally {
    t.close();
  }
});

it("does not send a selected warning after a concurrent committed start, and preserves its original deadline", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const t = fixture();
  try {
    t.store.db
      .prepare("UPDATE attempts SET preflight_started_at=? WHERE id='attempt'")
      .run(Date.now() - PREFLIGHT_TIMEOUT_MS);
    t.fail(new AgentCommandDisconnectedError("SSH connection ended"), true);
    await expect(
      t.life.cancelPreflight("attempt", "expired"),
    ).rejects.toThrow();
    const notice = t.store.db
      .prepare("SELECT id,next FROM outbox")
      .get() as any;
    vi.setSystemTime(notice.next);
    expect(t.life.preparePreflightNotification(notice.id)).toBe(true);
    const start = Date.now(),
      deadline = start + 5400000;
    t.life.acceptRemote({
      ...t.remote,
      state: "ACTIVE",
      start,
      deadline,
      original_deadline: deadline,
    });
    expect(t.life.preparePreflightNotification(notice.id)).toBe(false);
    expect(t.store.attempt("attempt")).toMatchObject({
      state: "LOCKED",
      start,
      deadline,
      original_deadline: deadline,
    });
  } finally {
    t.close();
    vi.useRealTimers();
  }
});

it("an explicit agent rejection supersedes the deferred warning and alerts immediately", async () => {
  const t = fixture();
  try {
    t.fail(new AgentCommandDisconnectedError("SSH connection ended"), true);
    await expect(
      t.life.cancelPreflight("attempt", "expired"),
    ).rejects.toThrow();
    t.fail(Error("invalid recorded workload unit"));
    await expect(
      t.life.cancelPreflight("attempt", "expired"),
    ).rejects.toThrow();
    const notices = t.store.db
      .prepare("SELECT id,status,next,body FROM outbox ORDER BY rowid")
      .all() as any[];
    expect(notices[0].status).toBe("cancelled");
    expect(t.life.preparePreflightNotification(notices[1].id)).toBe(true);
    expect(notices[1].body).toContain("invalid recorded workload unit");
  } finally {
    t.close();
  }
});

it("suppresses an unsent SMTP retry when its late signed cancellation arrives", async () => {
  const t = fixture();
  try {
    t.fail(new AgentCommandDisconnectedError("SSH connection ended"), true);
    await expect(
      t.life.cancelPreflight("attempt", "expired"),
    ).rejects.toThrow();
    const notice = t.store.db.prepare("SELECT id FROM outbox").get() as any;
    t.store.db
      .prepare("UPDATE outbox SET tries=2,next=? WHERE id=?")
      .run(Date.now() - 1, notice.id);
    expect(t.life.preparePreflightNotification(notice.id)).toBe(true);
    t.life.acceptRemote({ ...t.remote, state: "CANCELLED_BEFORE_START" });
    expect(t.life.preparePreflightNotification(notice.id)).toBe(false);
  } finally {
    t.close();
  }
});
it("a concurrent committed start preserves timing and does not email that preflight cleanup is pending", async () => {
  const t = fixture();
  try {
    t.fail(Error("cannot cancel started attempt"));
    Object.assign(t.remote, {
      state: "ACTIVE",
      start: Date.now(),
      deadline: Date.now() + 300000,
      original_deadline: Date.now() + 300000,
    });
    await expect(
      t.life.cancelPreflight("attempt", "signed out"),
    ).rejects.toThrow("cannot cancel started attempt");
    expect(t.store.attempt("attempt")).toMatchObject({
      state: "LOCKED",
      deadline: t.remote.deadline,
      original_deadline: t.remote.original_deadline,
    });
    expect(t.log.mock.calls[0][0].outcome).toBe("attempt-started");
    expect(t.alerts()).toHaveLength(0);
  } finally {
    t.close();
  }
});

it("a signed native cancellation with actual cleanup errors alerts immediately and deduplicates repeated reports", async () => {
  const t = fixture();
  try {
    t.fail(new AgentCommandDisconnectedError("SSH connection ended"), true);
    await expect(
      t.life.cancelPreflight("attempt", "expired"),
    ).rejects.toThrow();
    const remote = {
      ...t.remote,
      state: "CANCELLED_BEFORE_START",
      errors: ["invalid recorded workload unit"],
    };
    t.life.acceptRemote(remote);
    t.life.acceptRemote(remote);
    const pending = t.store.db
      .prepare("SELECT id,subject,body FROM outbox WHERE status='pending'")
      .all() as any[];
    expect(pending).toHaveLength(1);
    expect(pending[0].subject).toBe("Preflight cleanup error: alice (exam)");
    expect(pending[0].body).toContain('"invalid recorded workload unit"');
    expect(t.life.preparePreflightNotification(pending[0].id)).toBe(true);
  } finally {
    t.close();
  }
});
it("never copies arbitrary SSH error text, credentials or terminal output into cleanup diagnostics", async () => {
  const t = fixture();
  try {
    t.fail(
      Error("UNTRUSTED-SSH-OUTPUT private-password payload=secret-mfa-token"),
    );
    await expect(
      t.life.cancelPreflight("attempt", "expired"),
    ).rejects.toThrow();
    const diagnostic = JSON.stringify({
      logs: t.log.mock.calls,
      alerts: t.alerts(),
      audit: t.store.db.prepare("SELECT * FROM audit").all(),
    });
    expect(diagnostic).not.toMatch(
      /UNTRUSTED|private-password|secret-mfa-token/,
    );
    expect(diagnostic).toContain("command-failed");
  } finally {
    t.close();
  }
});
it.each([true, false])(
  "restoration email states protection correctly (secured=%s) and includes student/exam context",
  (secured) => {
    const t = fixture(secured ? "COMPLETED" : "COLLECTION_FAILED");
    try {
      t.store.db
        .prepare("UPDATE attempts SET start=1,protected=? WHERE id='attempt'")
        .run(secured ? 1 : 0);
      const remote = {
        state: secured ? "COMPLETED" : "COLLECTION_FAILED",
        protected: secured,
        access_state: "HELD",
        access_error:
          "uncontained process 123 for exam UID; collection refused until all writers are quiesced",
      };
      t.life.syncAccess("attempt", remote);
      t.life.syncAccess("attempt", remote);
      expect(t.alerts()).toHaveLength(1);
      expect(t.alerts()[0].body).toContain(
        "Student: alice\nExam: exam\nAttempt: attempt",
      );
      expect(t.alerts()[0].body).toContain(
        secured ? "submission is already secured" : "has not been confirmed",
      );
      expect(t.alerts()[0].body).toContain("account restoration blocked");
      expect(t.alerts()[0].body).not.toContain("collection refused");
      expect(t.store.attempt("attempt").access_state).toBe("HELD");
    } finally {
      t.close();
    }
  },
);
