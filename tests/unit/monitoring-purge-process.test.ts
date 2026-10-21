import { expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  chmodSync,
  renameSync,
  linkSync,
  readlinkSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { relative } from "node:path";
import { Store } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { MonitoringPurgeProcess } from "../../apps/server/src/monitoring-purge-process.js";

function fixture() {
  const store = new Store(mkdtempSync(tmpdir() + "/purge-process-"));
  new Monitoring(store);
  const root = `${store.dir}/monitoring`;
  const protectedPath = `${store.dir}/submissions/immutable`;
  writeFileSync(protectedPath, "protected bytes");
  const target = (id: string) => {
    mkdirSync(`${root}/${id}`, { mode: 0o700 });
    writeFileSync(`${root}/${id}/record.ndjson`, "PRIVATE-MONITORING\n");
    store.db.prepare("INSERT INTO tombstones VALUES(?,?)").run(id, Date.now());
    return `${root}/${id}`;
  };
  return {
    store,
    root,
    target,
    protectedPath,
    close() {
      expect(readFileSync(protectedPath, "utf8")).toBe("protected bytes");
      store.close();
      rmSync(store.dir, { recursive: true, force: true });
    },
  };
}

it.skipIf(process.platform !== "linux")(
  "resolves configured relative data paths without bypassing independent removal verification",
  async () => {
    const f = fixture();
    const original = f.store.dir;
    const dir = f.target("deleted");
    f.store.dir = relative(process.cwd(), original);
    const worker = new MonitoringPurgeProcess(f.store);
    try {
      await expect(worker.run("deleted")).resolves.toEqual({ removed: 1 });
      expect(existsSync(dir)).toBe(false);
    } finally {
      await worker.close();
      f.store.dir = original;
      f.close();
    }
  },
);

it.skipIf(process.platform !== "linux")(
  "purges only a tombstoned pinned private flat directory, without following links or opening FIFOs",
  async () => {
    const f = fixture(),
      process = new MonitoringPurgeProcess(f.store);
    try {
      const dir = f.target("deleted");
      symlinkSync(f.protectedPath, `${dir}/link`);
      execFileSync("mkfifo", [`${dir}/fifo`]);
      await expect(process.run("missing-tombstone")).rejects.toMatchObject({
        code: "requires-durable-deletion",
      });
      await expect(process.run("../submissions")).rejects.toMatchObject({
        code: "invalid-target",
      });
      expect(await process.run("deleted")).toEqual({ removed: 3 });
      expect(existsSync(dir)).toBe(false);
      expect(await process.run("deleted")).toEqual({ removed: 0 });
      expect(
        f.store.db.prepare("SELECT attempt FROM tombstones").all(),
      ).toEqual([{ attempt: "deleted" }]);
    } finally {
      await process.close();
      f.close();
    }
  },
);

it.skipIf(process.platform !== "linux")(
  "holds a persistent cross-coordinator lock through the exact worker lifetime and releases it on death",
  async () => {
    const f = fixture();
    const first = new MonitoringPurgeProcess(f.store, {
      entry: new URL("../fixtures/faulting-purge-worker.ts", import.meta.url),
      timeoutMs: 5000,
    });
    const second = new MonitoringPurgeProcess(f.store);
    try {
      f.target("hang");
      const other = f.target("other");
      const pending = first.run("hang").catch((error) => error);
      // Wait for no-fork flock to exec the fault worker, proving lock acquisition.
      const limit = Date.now() + 2000;
      while (readlinkSync(`/proc/${first.pid}/exe`) !== process.execPath) {
        if (Date.now() >= limit) throw Error("purge worker did not start");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await expect(second.run("other")).rejects.toMatchObject({ code: "busy" });
      expect(readFileSync(`${other}/record.ndjson`, "utf8")).toBe(
        "PRIVATE-MONITORING\n",
      );
      const lock = `${f.store.dir}/monitoring-purge.lock`;
      const { ino, mode } = statSync(lock);
      expect(mode & 0o777).toBe(0o600);
      await first.close();
      expect((await pending).code).toBe("worker-exit");
      await expect(second.run("other")).resolves.toEqual({ removed: 1 });
      await expect(second.run("hang")).resolves.toEqual({ removed: 1 });
      expect(statSync(lock).ino).toBe(ino);
    } finally {
      await first.close();
      await second.close();
      f.close();
    }
  },
);

it.skipIf(process.platform !== "linux")(
  "refuses redirected, shared, public and special lock inodes without spawning a worker",
  async () => {
    const f = fixture(),
      worker = new MonitoringPurgeProcess(f.store);
    const lock = `${f.store.dir}/monitoring-purge.lock`;
    try {
      f.target("deleted");
      for (const make of [
        () => symlinkSync(f.protectedPath, lock),
        () => linkSync(f.protectedPath, lock),
        () => writeFileSync(lock, "", { mode: 0o644 }),
        () => execFileSync("mkfifo", [lock]),
      ]) {
        make();
        await expect(worker.run("deleted")).rejects.toMatchObject({
          code: "unsafe-lock",
        });
        expect(worker.pid).toBeUndefined();
        rmSync(lock);
      }
      await expect(worker.run("deleted")).resolves.toEqual({ removed: 1 });
    } finally {
      await worker.close();
      f.close();
    }
  },
);

it.skipIf(process.platform !== "linux")(
  "refuses redirected roots/targets and unexpected subdirectories without removing protected storage",
  async () => {
    const f = fixture(),
      process = new MonitoringPurgeProcess(f.store);
    try {
      const dir = f.target("deleted");
      mkdirSync(`${dir}/unexpected`, { mode: 0o700 });
      await expect(process.run("deleted")).rejects.toMatchObject({
        code: "unexpected-directory",
      });
      expect(existsSync(`${dir}/unexpected`)).toBe(true);
      renameSync(dir, `${dir}-original`);
      symlinkSync(`${f.store.dir}/submissions`, dir);
      await expect(process.run("deleted")).rejects.toMatchObject({
        code: "unsafe-target",
      });
      renameSync(f.root, f.root + "-original");
      symlinkSync(`${f.store.dir}/submissions`, f.root);
      await expect(process.run("deleted")).rejects.toMatchObject({
        code: "unsafe-root",
      });
    } finally {
      await process.close();
      f.close();
    }
  },
);

it.skipIf(process.platform !== "linux" || process.getuid?.() === 0)(
  "contains real permission failures and retries without clearing deletion history",
  async () => {
    const f = fixture(),
      process = new MonitoringPurgeProcess(f.store);
    const dir = f.target("deleted");
    try {
      const before = f.store.db.prepare("SELECT * FROM tombstones").all();
      chmodSync(dir, 0o500);
      await expect(process.run("deleted")).rejects.toMatchObject({
        code: "permission",
      });
      expect(readFileSync(`${dir}/record.ndjson`, "utf8")).toBe(
        "PRIVATE-MONITORING\n",
      );
      chmodSync(dir, 0o700);
      await expect(process.run("deleted")).resolves.toEqual({ removed: 1 });
      expect(f.store.db.prepare("SELECT * FROM tombstones").all()).toEqual(
        before,
      );
    } finally {
      if (existsSync(dir)) chmodSync(dir, 0o700);
      await process.close();
      f.close();
    }
  },
);

it.skipIf(process.platform !== "linux")(
  "contains actual worker death, heap exhaustion, hang and invalid replies; leaves deletion durable and supports a fresh healthy purge",
  async () => {
    const f = fixture();
    const process = new MonitoringPurgeProcess(f.store, {
      entry: new URL("../fixtures/faulting-purge-worker.ts", import.meta.url),
      timeoutMs: 1500,
    });
    const healthy = new MonitoringPurgeProcess(f.store);
    let pulses = 0;
    const timer = setInterval(() => pulses++, 20);
    try {
      for (const id of [
        "panic",
        "kill",
        "heap",
        "hang",
        "overflow",
        "wrong",
        "extra",
        "forged",
        "exit-after-reply",
      ]) {
        const dir = f.target(id);
        const error = await process.run(id).then(
          () => {
            throw Error("unexpected purge success");
          },
          (error) => error,
        );
        expect(error.message).not.toMatch(/PRIVATE|\/tmp|record\.ndjson/);
        expect(error.code).toBe(
          id === "hang"
            ? "timeout"
            : id === "forged"
              ? "unverified"
              : id === "wrong" || id === "overflow" || id === "extra"
                ? "protocol"
                : "worker-exit",
        );
        expect(readFileSync(`${dir}/record.ndjson`, "utf8")).toBe(
          "PRIVATE-MONITORING\n",
        );
        expect(
          f.store.db
            .prepare("SELECT 1 FROM tombstones WHERE attempt=?")
            .get(id),
        ).toBeTruthy();
        await expect(healthy.run(id)).resolves.toEqual({ removed: 1 });
      }
      expect(pulses).toBeGreaterThan(10);
    } finally {
      clearInterval(timer);
      await process.close();
      await healthy.close();
      f.close();
    }
  },
  15000,
);

it.skipIf(process.platform !== "linux")(
  "refuses overlapping jobs and shutdown kills only the owned worker without clearing deletion",
  async () => {
    const f = fixture();
    const process = new MonitoringPurgeProcess(f.store, {
      entry: new URL("../fixtures/faulting-purge-worker.ts", import.meta.url),
      timeoutMs: 5000,
    });
    try {
      const dir = f.target("hang");
      const pending = process.run("hang").then(
        () => {
          throw Error("unexpected success");
        },
        (error) => error,
      );
      expect(process.pid).toBeTypeOf("number");
      await expect(process.run("hang")).rejects.toMatchObject({ code: "busy" });
      await process.close();
      expect((await pending).code).toBe("worker-exit");
      expect(process.pid).toBeUndefined();
      expect(readFileSync(`${dir}/record.ndjson`, "utf8")).toBe(
        "PRIVATE-MONITORING\n",
      );
      expect(
        f.store.db.prepare("SELECT count(*) n FROM tombstones").get(),
      ).toEqual({ n: 1 });
    } finally {
      await process.close();
      f.close();
    }
  },
);
