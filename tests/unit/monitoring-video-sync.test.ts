import { expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  chmodSync,
  renameSync,
  symlinkSync,
  linkSync,
} from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { Store } from "../../apps/server/src/db.js";
import { MonitoringVideoProcess } from "../../apps/server/src/monitoring-video-process.js";
const entry = new URL(
  "../fixtures/tracing-video-sync-worker.ts",
  import.meta.url,
);
function rawFixture() {
  const dir = mkdtempSync(join(tmpdir(), "video-sync-barrier-"));
  mkdirSync(join(dir, "monitoring"), { mode: 0o700 });
  writeFileSync(
    join(dir, "metadata.sqlite"),
    "synthetic private database bytes",
    { mode: 0o644 },
  );
  writeFileSync(
    join(dir, "metadata.sqlite-wal"),
    "synthetic private WAL bytes",
    { mode: 0o644 },
  );
  return {
    dir,
    store: { dir } as Store,
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
it.skipIf(process.platform !== "linux")(
  "fsyncs the real NORMAL WAL, database and private parent in a different PID without changing SQLite policy or releasing its active writer lock",
  async () => {
    const store = new Store(mkdtempSync(join(tmpdir(), "video-sync-real-")));
    mkdirSync(join(store.dir, "monitoring"), { mode: 0o700, recursive: true });
    store.db.exec(
      "CREATE TABLE barrier_probe(value TEXT);INSERT INTO barrier_probe VALUES('committed')",
    );
    chmodSync(join(store.dir, "metadata.sqlite"), 0o644);
    chmodSync(join(store.dir, "metadata.sqlite-wal"), 0o644);
    const worker = new MonitoringVideoProcess(store, { entry });
    try {
      expect(store.db.pragma("synchronous", { simple: true })).toBe(1);
      expect(store.db.pragma("journal_mode", { simple: true })).toBe("wal");
      const before = readFileSync(join(store.dir, "metadata.sqlite-wal"));
      await worker.sync();
      expect(readFileSync(join(store.dir, "metadata.sqlite-wal"))).toEqual(
        before,
      );
      const trace = JSON.parse(
        readFileSync(join(store.dir, "sync-trace.json"), "utf8"),
      );
      expect(trace.map((row: any) => row.file)).toEqual([
        "metadata.sqlite-wal",
        "metadata.sqlite",
        basename(store.dir),
      ]);
      expect(trace.every((row: any) => row.pid !== process.pid)).toBe(true);
      store.db.exec(
        "BEGIN IMMEDIATE;INSERT INTO barrier_probe VALUES('uncommitted')",
      );
      try {
        await worker.sync();
        const observed = JSON.parse(
          execFileSync(
            process.execPath,
            [
              "--input-type=module",
              "-e",
              "import Database from 'better-sqlite3';const db=new Database(process.argv[1],{timeout:0});try{db.exec('BEGIN IMMEDIATE');db.exec('ROLLBACK');console.log(JSON.stringify({busy:false}));}catch(error){console.log(JSON.stringify({busy:error.code==='SQLITE_BUSY'}));}finally{db.close();}",
              join(store.dir, "metadata.sqlite"),
            ],
            { encoding: "utf8", timeout: 5000 },
          ),
        );
        expect(observed).toEqual({ busy: true });
      } finally {
        store.db.exec("ROLLBACK");
      }
      expect(store.db.prepare("SELECT value FROM barrier_probe").all()).toEqual(
        [{ value: "committed" }],
      );
      expect(store.db.pragma("synchronous", { simple: true })).toBe(1);
      expect(store.db.pragma("journal_mode", { simple: true })).toBe("wal");
    } finally {
      await worker.close();
      store.close();
      rmSync(store.dir, { recursive: true, force: true });
    }
  },
  15000,
);

it.skipIf(process.platform !== "linux")(
  "refuses missing, redirected and multiply-linked WAL files without acknowledging the deletion barrier",
  async () => {
    const f = rawFixture(),
      worker = new MonitoringVideoProcess(f.store);
    const wal = join(f.dir, "metadata.sqlite-wal"),
      saved = wal + ".saved";
    try {
      renameSync(wal, saved);
      await expect(worker.sync()).rejects.toMatchObject({ code: "storage" });
      symlinkSync(saved, wal);
      await expect(worker.sync()).rejects.toMatchObject({ code: "storage" });
      rmSync(wal);
      linkSync(saved, wal);
      await expect(worker.sync()).rejects.toMatchObject({
        code: "unsafe-target",
      });
      rmSync(wal);
      renameSync(saved, wal);
      await expect(worker.sync()).resolves.toBeUndefined();
    } finally {
      await worker.close();
      f.close();
    }
  },
  15000,
);

it.skipIf(process.platform !== "linux")(
  "refuses a database inode replaced between actual WAL fsync and the final path check",
  async () => {
    const f = rawFixture(),
      worker = new MonitoringVideoProcess(f.store, { entry });
    writeFileSync(
      join(f.dir, "replace-db-after-sync"),
      "test-only replacement control",
      { mode: 0o600 },
    );
    try {
      await expect(worker.sync()).rejects.toMatchObject({
        code: "sync-changed",
      });
      expect(
        readFileSync(join(f.dir, "metadata-before-replacement"), "utf8"),
      ).toBe("synthetic private database bytes");
    } finally {
      await worker.close();
      f.close();
    }
  },
  15000,
);
