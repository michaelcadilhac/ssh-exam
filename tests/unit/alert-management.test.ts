import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";
import { Alerts } from "../../apps/server/src/alerts.js";
import { AlertManagement } from "../../apps/server/src/alert-management.js";

it("fences explicit reminders, keeps automatic episodes stable and cancels obsolete unsent mail", () => {
  const dir = mkdtempSync(tmpdir() + "/alert-management-");
  let store = new Store(dir);
  try {
    store.db.exec(
      "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,generation,start,deadline,original_deadline,access_state) VALUES('a','e','synthetic',1001,'LOCKED','{}',2,1,9000000000000,9000000000000,'HELD');",
    );
    const before = store.attempt("a");
    let alerts = new Alerts(store);
    let service = new AlertManagement(store, () => true);
    const key = {
      attempt: "a",
      event: "interruption",
      generation: 2,
      cause: "test-cause",
    };
    const outbox = alerts.enqueue(
      "Synthetic interruption",
      "PRIVATE REVIEW OR MONITORING TEXT",
      key,
    );
    expect(service.show(outbox).remindable).toBe(false);
    store.db
      .prepare("UPDATE outbox SET status='failed',tries=10 WHERE id=?")
      .run(outbox);
    const episode = service.show(outbox).episode!;
    const input = {
      id: episode.id,
      revision: episode.revision,
      reason: "Deliberate instructor reminder",
    };
    const request = randomUUID();
    const first = service.withRequest("teacher", request, input, () =>
      service.remind(input, "teacher"),
    );
    expect(first).toMatchObject({ queued: true, delivered: false });
    expect(service.show(outbox).remindable).toBe(false);
    expect(() => service.remind(input, "other-admin")).toThrow("changed");
    expect(alerts.enqueue("Same automatic episode", "unchanged", key)).toBe(
      outbox,
    );
    expect(
      store.db
        .prepare("SELECT status,tries FROM outbox WHERE id=?")
        .get(outbox),
    ).toEqual({ status: "failed", tries: 10 });
    expect(
      store.db.prepare("SELECT body FROM outbox WHERE id=?").get(first.outbox),
    ).toMatchObject({
      body: expect.not.stringContaining("PRIVATE REVIEW OR MONITORING TEXT"),
    });
    const serialized = JSON.stringify(service.page({}));
    expect(serialized).not.toContain("PRIVATE REVIEW OR MONITORING TEXT");
    expect(serialized).not.toContain("test-cause");
    expect(service.page({ limit: 1 }).next).not.toBeNull();
    store.close();
    store = new Store(dir);
    alerts = new Alerts(store);
    service = new AlertManagement(store, () => true);
    expect(
      service.withRequest("teacher", request, input, () => {
        throw Error("reexecuted");
      }),
    ).toEqual(first);
    expect(() =>
      service.withRequest(
        "teacher",
        request,
        { ...input, reason: "Changed reminder" },
        () => null,
      ),
    ).toThrow("conflicts");
    alerts.resolve("a", "interruption", 2);
    expect(
      store.db
        .prepare("SELECT status FROM outbox WHERE id=?")
        .get(first.outbox),
    ).toEqual({ status: "cancelled" });
    expect(service.show(outbox).refusal).toContain("resolved");
    expect(() => service.remind(input, "teacher")).toThrow("changed");
    const recurring = alerts.enqueue("New episode", "new private body", key);
    expect(recurring).not.toBe(outbox);
    store.db
      .prepare("UPDATE outbox SET status='sent' WHERE id=?")
      .run(recurring);
    const next = service.show(recurring).episode!;
    const queued = service.remind(
      {
        id: next.id,
        revision: next.revision,
        reason: "Explicit recurring failure reminder",
      },
      "teacher",
    );
    store.db.prepare("UPDATE attempts SET generation=3 WHERE id='a'").run();
    expect(service.prepareForDelivery(queued.outbox)).toBe(false);
    expect(service.show(queued.outbox).status).toBe("cancelled");
    store.db.prepare("UPDATE attempts SET generation=2 WHERE id='a'").run();
    expect(store.attempt("a")).toEqual(before);
    expect(
      store.db.prepare("SELECT result FROM alert_management_requests").all(),
    ).not.toEqual([]);
    expect(
      JSON.stringify(
        store.db.prepare("SELECT result FROM alert_management_requests").all(),
      ),
    ).not.toContain("PRIVATE REVIEW");
    expect(store.db.pragma("foreign_key_check")).toEqual([]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("refuses unconfigured tests, supports bounded metadata filters and atomically rolls back failed audit", () => {
  const dir = mkdtempSync(tmpdir() + "/alert-management-errors-");
  const store = new Store(dir);
  try {
    const service = new AlertManagement(store, () => false);
    expect(() => service.test("teacher")).toThrow("SMTP is not configured");
    const live = new AlertManagement(store, () => true);
    const id = randomUUID();
    const queued = live.withRequest("teacher", id, {}, () =>
      live.test("teacher"),
    );
    expect(
      live.withRequest("teacher", id, {}, () => live.test("teacher")),
    ).toEqual(queued);
    expect(live.show(queued.outbox).refusal).toContain(
      "No durable failure episode",
    );
    expect(live.page({ status: "sent" }).alerts).toHaveLength(0);
    expect(live.page({ status: "pending" }).alerts).toHaveLength(1);
    expect(() => live.page({ limit: 201 })).toThrow();
    store.db.exec(
      "CREATE TRIGGER fail_alert_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;",
    );
    expect(() =>
      live.withRequest("teacher", randomUUID(), {}, () => live.test("teacher")),
    ).toThrow("audit failure");
    expect(store.db.prepare("SELECT count(*) n FROM outbox").get()).toEqual({
      n: 1,
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("bounds reminder inspection and rolls back obsolete-mail cancellation if audit fails", () => {
  const dir = mkdtempSync(tmpdir() + "/alert-history-bound-");
  const store = new Store(dir);
  try {
    const alerts = new Alerts(store);
    const service = new AlertManagement(store, () => true);
    const source = alerts.enqueue("Synthetic bounded history", "private body", {
      attempt: "historical",
      event: "collection-failure",
      generation: 0,
      cause: "synthetic",
    });
    store.db.prepare("UPDATE outbox SET status='sent' WHERE id=?").run(source);
    let last = "";
    for (let n = 0; n < 13; n++) {
      const episode = service.show(source).episode;
      last = service.remind(
        {
          id: episode.id,
          revision: episode.revision,
          reason: `Explicit synthetic follow-up ${n}`,
        },
        "teacher",
      ).outbox;
      if (n !== 12)
        store.db
          .prepare("UPDATE outbox SET status='sent' WHERE id=?")
          .run(last);
    }
    // Even an older-timestamp pending row outside the ten shown reminders must
    // block a new message (e.g. clock adjustment), not disappear behind paging.
    store.db
      .prepare("UPDATE alert_reminders SET created=0 WHERE outbox=?")
      .run(last);
    const shown = service.show(source);
    expect(shown.episode.reminderCount).toBe(13);
    expect(shown.episode.reminders).toHaveLength(10);
    expect(shown.remindable).toBe(false);
    store.db
      .prepare("UPDATE alert_episodes SET resolved=1 WHERE id=?")
      .run(shown.episode.id);
    store.db.exec(
      "CREATE TRIGGER fail_cancel_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'synthetic cancel audit failure'); END;",
    );
    expect(() => service.prepareForDelivery(last)).toThrow(
      "cancel audit failure",
    );
    expect(
      store.db.prepare("SELECT status FROM outbox WHERE id=?").get(last),
    ).toEqual({ status: "pending" });
    store.db.exec("DROP TRIGGER fail_cancel_audit");
    expect(service.prepareForDelivery(last)).toBe(false);
    expect(service.show(last).status).toBe("cancelled");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
