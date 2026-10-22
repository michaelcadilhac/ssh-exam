import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { hash, type Store } from "./db.js";

export class MonitoringMediaError extends Error {
  readonly statusCode = 503;
  constructor(
    public readonly reason:
      | "capacity"
      | "unsafe-path"
      | "unsafe-directory"
      | "not-regular"
      | "linked"
      | "size"
      | "changed"
      | "digest"
      | "storage",
  ) {
    super(
      reason === "capacity"
        ? "Monitoring image read capacity is busy; retry shortly. Student capture and exam clocks are unchanged"
        : `Monitoring image read refused (${reason}); refresh review and ask the operator to inspect private storage/permissions. Preserve deletion records and protected submissions`,
    );
  }
}
const deleted = () =>
  Object.assign(
    Error(
      "Monitoring was deleted; restored orphan files cannot be viewed. Protected submissions have independent retention",
    ),
    { statusCode: 410 },
  );

// Shared existing-image read boundary. No files/clock/hold mutation, no private
// byte cache. This is async bounded descriptor IO, NOT a process/OS fault sandbox.
export class MonitoringMedia {
  private inflight = 0;
  constructor(private store: Store) {}
  assertRetained(id: string) {
    let tombstone: unknown;
    try {
      tombstone = this.store.db
        .prepare("SELECT 1 FROM tombstones WHERE attempt=?")
        .get(id);
    } catch {
      throw new MonitoringMediaError("storage");
    }
    if (tombstone) throw deleted();
  }
  async read(
    id: string,
    thumbnail: boolean,
    actor: string,
    expectedAttempt?: string,
  ) {
    z.string().uuid().parse(id);
    let row: { id: string; attempt: string; hash: string } | undefined;
    try {
      row = this.store.db
        .prepare("SELECT id,attempt,hash FROM frames WHERE id=?")
        .get(id) as typeof row;
    } catch {
      throw new MonitoringMediaError("storage");
    }
    if (
      !row ||
      (expectedAttempt !== undefined && row.attempt !== expectedAttempt)
    )
      throw Object.assign(
        Error("Monitoring image not found; refresh the monitoring inventory"),
        { statusCode: 404 },
      );
    this.assertRetained(row.attempt);
    if (this.inflight >= 16) throw new MonitoringMediaError("capacity");
    this.inflight++;
    const handles: FileHandle[] = [];
    try {
      if (
        process.platform !== "linux" ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(row.attempt) ||
        !/^[a-f0-9]{64}$/.test(row.hash)
      )
        throw new MonitoringMediaError("storage");
      const directory = async (path: string) => {
        const fd = await open(
          path,
          constants.O_RDONLY |
            constants.O_DIRECTORY |
            constants.O_NOFOLLOW |
            constants.O_NONBLOCK,
        );
        handles.push(fd);
        const info = await fd.stat();
        if (
          !info.isDirectory() ||
          info.uid !== process.geteuid?.() ||
          (info.mode & 0o077) !== 0
        )
          throw new MonitoringMediaError("unsafe-directory");
        return fd;
      };
      const root = await directory(resolve(this.store.dir, "monitoring"));
      const attempt = await directory(
        `/proc/self/fd/${root.fd}/${row.attempt}`,
      );
      // Intentional pinned proc-fd traversal; never follow a restored leaf or
      // parent-directory symlink. NONBLOCK ensures a FIFO cannot stall HTTP.
      const file = await open(
        `/proc/self/fd/${attempt.fd}/${row.id}${thumbnail ? ".thumb" : ""}.jpg`,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      handles.push(file);
      const info = await file.stat(),
        limit = thumbnail ? 2 * 1024 * 1024 : 1500000;
      if (!info.isFile()) throw new MonitoringMediaError("not-regular");
      if (info.nlink !== 1) throw new MonitoringMediaError("linked");
      if (info.uid !== process.geteuid?.())
        throw new MonitoringMediaError("storage");
      if (info.size < 1 || info.size > limit)
        throw new MonitoringMediaError("size");
      const bytes = Buffer.alloc(info.size + 1);
      let count = 0;
      while (count < bytes.length) {
        const part = await file.read(bytes, count, bytes.length - count, count);
        if (!part.bytesRead) break;
        count += part.bytesRead;
      }
      const after = await file.stat();
      if (
        count !== info.size ||
        after.size !== info.size ||
        after.mtimeMs !== info.mtimeMs ||
        after.ctimeMs !== info.ctimeMs ||
        after.nlink !== 1
      )
        throw new MonitoringMediaError("changed");
      const data = bytes.subarray(0, count);
      // Originals have a persisted upload hash. Legacy thumbnail rows have no
      // independent hash: descriptor/bounds protect those reads, not a claim of
      // cryptographic thumbnail provenance or a fresh capture verification.
      if (!thumbnail && hash(data) !== row.hash)
        throw new MonitoringMediaError("digest");
      this.assertRetained(row.attempt); // Retention may run while async IO is pending.
      this.store.audit(
        actor,
        "view-media",
        row.attempt,
        JSON.stringify({ id, thumbnail }),
      );
      return { id, attempt: row.attempt, thumbnail, data };
    } catch (error) {
      if (
        error instanceof MonitoringMediaError ||
        (error as any)?.statusCode === 410
      )
        throw error;
      throw new MonitoringMediaError(
        ["ELOOP", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException)?.code || "",
        )
          ? "unsafe-path"
          : "storage",
      ); // No private paths/raw storage errors.
    } finally {
      await Promise.allSettled(handles.map((fd) => fd.close()));
      this.inflight--;
    }
  }
}
