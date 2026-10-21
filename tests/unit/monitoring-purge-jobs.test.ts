import { expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readlinkSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import {
  MonitoringPurgeJobs,
  monitoringPurgeStatus,
} from "../../apps/server/src/monitoring-purge-jobs.js";

function fixture() {
  const store = new Store(mkdtempSync(tmpdir() + "/purge-jobs-"));
  const monitoring = new Monitoring(store);
  store.db.exec("INSERT INTO exams VALUES('e','{}')");
  const seed = (id: string, ended: number | null = Date.now()) => {
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,ended) VALUES(?,'e',?,1001,'COMPLETED','{}',?)",
      )
      .run(id, id, ended);
    monitoring.record(id, "pane", { note: "PRIVATE-MEDIA" });
    return `${store.dir}/monitoring/${id}`;
  };
  writeFileSync(`${store.dir}/submissions/protected`, "immutable");
  return {
    store,
    monitoring,
    seed,
    close() {
      expect(readFileSync(`${store.dir}/submissions/protected`, "utf8")).toBe(
        "immutable",
      );
      store.close();
      rmSync(store.dir, { recursive: true, force: true });
    },
  };
}

it("atomically scrubs, tombstones and queues without filesystem IO, preserves first deletion and rolls back failed enqueue", () => {
  const f = fixture();
  try {
    const path = f.seed("a");
    const authority = f.store.attempt("a");
    f.store.db.exec(
      "CREATE TRIGGER fail_queue BEFORE INSERT ON monitoring_purges BEGIN SELECT RAISE(ABORT,'PRIVATE-STORAGE-FAILURE'); END",
    );
    expect(() => f.monitoring.delete("a", "teacher")).toThrow();
    expect(f.store.db.prepare("SELECT * FROM tombstones").all()).toEqual([]);
    expect(f.store.db.prepare("SELECT * FROM recordings").all()).toHaveLength(
      1,
    );
    expect(
      f.store.db
        .prepare("SELECT * FROM audit WHERE action='delete-monitoring'")
        .all(),
    ).toEqual([]);
    f.store.db.exec("DROP TRIGGER fail_queue");
    f.monitoring.delete("a", "teacher");
    f.store.db.exec("UPDATE tombstones SET deleted=0");
    f.monitoring.delete("a", "teacher");
    expect(f.store.db.prepare("SELECT deleted FROM tombstones").get()).toEqual({
      deleted: 0,
    });
    expect(f.store.db.prepare("SELECT * FROM recordings").all()).toEqual([]);
    expect(
      f.store.db
        .prepare("SELECT * FROM audit WHERE action='delete-monitoring'")
        .all(),
    ).toHaveLength(1);
    expect(readFileSync(`${path}/pane.ndjson`, "utf8")).toContain(
      "PRIVATE-MEDIA",
    );
    expect(monitoringPurgeStatus(f.store, "a").status).toBe("pending");
    expect(f.store.attempt("a")).toEqual(authority);
    expect(() => f.monitoring.delete("../submissions", "teacher")).toThrow(
      "Invalid",
    );
  } finally {
    f.close();
  }
});

it("survives actual database reopen and retired preparation rows, and rechecks formerly verified directories", async () => {
  const f = fixture();
  let jobs: MonitoringPurgeJobs | undefined;
  try {
    const path = f.seed("a");
    f.monitoring.delete("a", "preflight-retry");
    f.store.db.prepare("DELETE FROM attempts WHERE id='a'").run();
    f.store.close();
    f.store = new Store(f.store.dir);
    jobs = new MonitoringPurgeJobs(f.store);
    await jobs.kick();
    expect(monitoringPurgeStatus(f.store, "a").status).toBe("verified-absent");
    expect(existsSync(path)).toBe(false);
    expect(f.store.db.prepare("SELECT * FROM tombstones").all()).toHaveLength(
      1,
    );
    // Synthetic restored orphan under a retained tombstone, not a new recording.
    mkdirSync(path, { mode: 0o700 });
    writeFileSync(`${path}/orphan`, "private");
    f.store.db
      .prepare("UPDATE monitoring_purges SET next=0 WHERE attempt='a'")
      .run();
    await jobs.kick();
    expect(existsSync(path)).toBe(false);
    expect(monitoringPurgeStatus(f.store, "a").status).toBe("verified-absent");
  } finally {
    await jobs?.close();
    // fixture.close retains the original store in its closure; reopened explicitly.
    expect(readFileSync(`${f.store.dir}/submissions/protected`, "utf8")).toBe(
      "immutable",
    );
    f.store.close();
    rmSync(f.store.dir, { recursive: true, force: true });
  }
});

it("recovers an unrecorded worker result after real SQLite update failure without leaving a permanently running claim", async () => {
  const f = fixture();
  const failures: string[] = [];
  const jobs = new MonitoringPurgeJobs(f.store, {
    onFailure: (code) => failures.push(code),
  });
  try {
    const path = f.seed("a");
    f.monitoring.delete("a", "teacher");
    f.store.db
      .exec(`CREATE TRIGGER fail_result BEFORE UPDATE ON monitoring_purges
      WHEN OLD.status='running' BEGIN SELECT RAISE(ABORT,'PRIVATE-RESULT-FAILURE'); END`);
    await jobs.kick();
    expect(existsSync(path)).toBe(false);
    expect(monitoringPurgeStatus(f.store, "a").status).toBe("running");
    expect(failures).toEqual(["job-store-unavailable"]);
    f.store.db.exec("DROP TRIGGER fail_result");
    await jobs.kick();
    expect(monitoringPurgeStatus(f.store, "a").status).toBe("verified-absent");
    expect(
      f.store.db.prepare("SELECT count(*) n FROM tombstones").get(),
    ).toEqual({ n: 1 });
  } finally {
    await jobs.close();
    f.close();
  }
});

it("bounds logical retention and legacy tombstone backfill batches without needing attempt rows", async () => {
  const f = fixture();
  const jobs = new MonitoringPurgeJobs(f.store);
  try {
    f.store.db.transaction(() => {
      for (let i = 0; i < 130; i++) {
        const id = `old${String(i).padStart(3, "0")}`;
        f.store.db
          .prepare(
            "INSERT INTO attempts(id,exam,username,uid,state,settings,ended) VALUES(?,'e',?,1001,'COMPLETED','{}',?)",
          )
          .run(id, id, Date.now() - 61 * 86400000);
      }
    })();
    expect(f.monitoring.cleanup()).toEqual({
      failed: 0,
      considered: 100,
      more: true,
    });
    expect(f.monitoring.cleanup()).toEqual({
      failed: 0,
      considered: 30,
      more: false,
    });
    expect(f.monitoring.cleanup()).toEqual({
      failed: 0,
      considered: 0,
      more: false,
    });
    f.store.db.exec("DELETE FROM monitoring_purges; DELETE FROM attempts");
    await jobs.kick();
    expect(
      f.store.db.prepare("SELECT count(*) n FROM monitoring_purges").get(),
    ).toEqual({ n: 100 });
    await jobs.kick();
    expect(
      f.store.db.prepare("SELECT count(*) n FROM monitoring_purges").get(),
    ).toEqual({ n: 130 });
    expect(
      f.store.db.prepare("SELECT count(*) n FROM tombstones").get(),
    ).toEqual({ n: 130 });
  } finally {
    await jobs.close();
    f.close();
  }
});

it("fences an old coordinator reply and does not overlap a surviving locked worker after restart recovery", async () => {
  const f = fixture();
  const first = new MonitoringPurgeJobs(f.store, {
    entry: new URL("../fixtures/faulting-purge-worker.ts", import.meta.url),
    timeoutMs: 5000,
  });
  let second: MonitoringPurgeJobs | undefined;
  try {
    const path = f.seed("hang");
    f.monitoring.delete("hang", "teacher");
    const pending = first.kick();
    const pid = (first as any).process.pid;
    const limit = Date.now() + 2000;
    while (readlinkSync(`/proc/${pid}/exe`) !== process.execPath) {
      if (Date.now() > limit) throw Error("locked worker did not start");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    second = new MonitoringPurgeJobs(f.store);
    await second.kick();
    expect(monitoringPurgeStatus(f.store, "hang")).toMatchObject({
      status: "retry",
      error: "busy",
      verified: null,
    });
    await first.close();
    await pending;
    expect(monitoringPurgeStatus(f.store, "hang").error).toBe("busy"); // Old owner cannot overwrite.
    expect(existsSync(path)).toBe(true);
    f.store.db
      .prepare("UPDATE monitoring_purges SET next=0 WHERE attempt='hang'")
      .run();
    await second.kick();
    expect(monitoringPurgeStatus(f.store, "hang").status).toBe(
      "verified-absent",
    );
    expect(existsSync(path)).toBe(false);
  } finally {
    await first.close();
    await second?.close();
    f.close();
  }
});
