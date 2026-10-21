import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { MonitoringManagement } from "../../apps/server/src/monitoring-management.js";
import { MonitoringPurgeJobs } from "../../apps/server/src/monitoring-purge-jobs.js";

function fixture() {
  const store = new Store(mkdtempSync(tmpdir() + "/monitoring-deletion-"));
  const media = new Monitoring(store),
    management = new MonitoringManagement(store, media);
  store.db
    .exec(`INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,ended,access_state,protected,checksum)
    VALUES('a','e','StudentA',1001,'COMPLETED','{}',100,200,200,150,'HELD',1,'immutable')`);
  media.record("a", "pane", { note: "PRIVATE-MEDIA" });
  writeFileSync(`${store.dir}/submissions/protected`, "immutable");
  const authority = store.attempt("a");
  const body = () => {
    const review = management.deletionReview("a");
    return {
      id: "a",
      confirm: review.confirm,
      revision: review.revision,
      requestID: randomUUID(),
      reason: "Reviewed retention request",
    };
  };
  return {
    store,
    management,
    body,
    close() {
      expect(store.attempt("a")).toEqual(authority);
      expect(readFileSync(`${store.dir}/submissions/protected`, "utf8")).toBe(
        "immutable",
      );
      store.close();
      rmSync(store.dir, { recursive: true, force: true });
    },
  };
}

it("refuses unnamed/stale/unfinished deletion and retains all monitoring until a reviewed eligible intent", () => {
  const f = fixture();
  try {
    expect(() =>
      f.management.delete({ id: "a", confirm: true }, "teacher"),
    ).toThrow("Reload");
    expect(() =>
      f.management.delete({ ...f.body(), confirm: "Other" }, "teacher"),
    ).toThrow("confirmation");
    expect(() =>
      f.management.delete({ ...f.body(), revision: "0".repeat(64) }, "teacher"),
    ).toThrow("changed after review");
    f.store.db.exec(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline) VALUES('b','e','ActiveB',1002,'ACTIVE','{}',100,200,200)",
    );
    const reviewActive = f.management.deletionReview("b");
    const active = {
      ...f.body(),
      id: "b",
      confirm: reviewActive.confirm,
      revision: reviewActive.revision,
    };
    expect(() => f.management.delete(active, "teacher")).toThrow(
      "before this attempt ends",
    );
    expect(f.store.db.prepare("SELECT * FROM tombstones").all()).toEqual([]);
    expect(f.store.db.prepare("SELECT * FROM recordings").all()).toHaveLength(
      1,
    );
    const review = f.management.deletionReview("a");
    expect(review.eligible).toBe(true);
    expect(review.consequence).toContain("future late callbacks");
  } finally {
    f.close();
  }
});

it("exact child retries survive changed review/job state without requeue, changed actor/arguments cannot reuse the intent", async () => {
  const f = fixture(),
    jobs = new MonitoringPurgeJobs(f.store);
  try {
    const body = f.body(),
      result = f.management.delete(body, "teacher");
    expect(result).toMatchObject({
      id: "a",
      requestID: body.requestID,
      status: "logical-deletion-accepted",
      physicalPurge: "pending-verification",
    });
    await jobs.kick();
    const before = f.store.db.prepare("SELECT * FROM monitoring_purges").get();
    expect(f.management.delete(body, "teacher")).toEqual(result);
    expect(f.store.db.prepare("SELECT * FROM monitoring_purges").get()).toEqual(
      before,
    );
    expect(() =>
      f.management.delete(
        { ...body, reason: "Different intent arguments" },
        "teacher",
      ),
    ).toThrow("conflicts");
    expect(() => f.management.delete(body, "other-admin")).toThrow(
      "changed after review",
    );
    const stored = JSON.stringify(
      f.store.db.prepare("SELECT * FROM monitoring_deletion_requests").all(),
    );
    expect(stored).not.toContain("PRIVATE-MEDIA");
    expect(
      f.store.db
        .prepare(
          "SELECT count(*) n FROM audit WHERE action='monitoring-delete-intent'",
        )
        .get(),
    ).toEqual({ n: 1 });
  } finally {
    await jobs.close();
    f.close();
  }
});

it("rolls back tombstone, scrub, job and audits if the durable deletion intent cannot be stored", () => {
  const f = fixture();
  try {
    const body = f.body();
    f.store.db.exec(
      "CREATE TRIGGER fail_intent BEFORE INSERT ON monitoring_deletion_requests BEGIN SELECT RAISE(ABORT,'PRIVATE-DATABASE-FAILURE'); END",
    );
    try {
      f.management.delete(body, "teacher");
      throw Error("unexpected success");
    } catch (error) {
      expect((error as any).statusCode).toBe(503);
      expect((error as Error).message).not.toContain("PRIVATE-DATABASE");
    }
    for (const table of [
      "tombstones",
      "monitoring_purges",
      "monitoring_deletion_requests",
      "audit",
    ])
      expect(f.store.db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    expect(f.store.db.prepare("SELECT * FROM recordings").all()).toHaveLength(
      1,
    );
    f.store.db.exec("DROP TRIGGER fail_intent");
    expect(f.management.delete(body, "teacher").logicalDeleted).toBe(true);
  } finally {
    f.close();
  }
});
