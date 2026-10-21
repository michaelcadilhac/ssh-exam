import { expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { MonitoringManagement } from "../../apps/server/src/monitoring-management.js";

it("pages only deletion/job metadata, including retired/unbackfilled epoch-zero tombstones, with indexed filters", () => {
  const store = new Store(mkdtempSync(tmpdir() + "/purge-inventory-"));
  const media = new Monitoring(store),
    management = new MonitoringManagement(store, media);
  writeFileSync(`${store.dir}/submissions/protected`, "immutable");
  try {
    store.db.exec(`INSERT INTO tombstones VALUES('a',1),('b',0),('c',3);
      INSERT INTO monitoring_purges(attempt,status,next,updated,error) VALUES('a','pending',100,100,NULL),('c','retry',200,200,'permission');
      INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('a','e','student',1001,'COMPLETED','{}');
      INSERT INTO recordings VALUES('private','a','PRIVATE-PANE',1)`);
    const first = management.purges({ limit: 1 }, "teacher");
    expect(first.entries.map((e) => e.id)).toEqual(["a"]);
    expect(first.next).toBe("a");
    const second = management.purges(
      { limit: 1, after: first.next },
      "teacher",
    );
    expect(second.entries[0]).toMatchObject({
      id: "b",
      deleted: 0,
      status: "not-verified",
      exam: null,
      username: null,
    });
    const last = management.purges({ limit: 1, after: second.next }, "teacher");
    expect(last.entries[0]).toMatchObject({
      id: "c",
      status: "retry",
      error: "permission",
    });
    expect(last.next).toBeNull();
    expect(
      management
        .purges({ status: "retry" }, "teacher")
        .entries.map((e) => e.id),
    ).toEqual(["c"]);
    expect(JSON.stringify([first, second, last])).not.toContain("PRIVATE");
    expect(management.purge({ id: "b" }, "teacher")).toMatchObject({
      id: "b",
      deleted: 0,
      attempt: null,
      job: { status: "not-verified", verified: null },
    });
    expect(management.purge({ id: "a" }, "teacher").attempt).toMatchObject({
      id: "a",
      username: "student",
    });
    expect(() => management.purge({ id: "missing" }, "teacher")).toThrow(
      "No durable",
    );
    for (const body of [
      { limit: 101 },
      { limit: 0 },
      { after: "../protected" },
      { status: "not-verified" },
      { extra: true },
    ])
      expect(() => management.purges(body, "teacher")).toThrow();
    const plan = store.db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT attempt FROM monitoring_purges WHERE status=? AND attempt>? ORDER BY attempt LIMIT ?",
      )
      .all("retry", "", 101);
    expect(JSON.stringify(plan)).toContain("monitoring_purges_status");
    expect(readFileSync(`${store.dir}/submissions/protected`, "utf8")).toBe(
      "immutable",
    );
    expect(store.db.prepare("SELECT count(*) n FROM tombstones").get()).toEqual(
      { n: 3 },
    );
    store.db.exec(
      "CREATE TRIGGER fail_inventory_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'PRIVATE-SQL-EXCEPTION'); END",
    );
    try {
      management.purges({}, "teacher");
      throw Error("unexpected success");
    } catch (error) {
      expect((error as any).statusCode).toBe(503);
      expect((error as Error).message).not.toContain("PRIVATE-SQL");
    }
  } finally {
    store.close();
    rmSync(store.dir, { recursive: true, force: true });
  }
});
