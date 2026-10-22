import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { createHash } from "node:crypto";
import { hash, type Store } from "./db.js";
import { monitoringExportChunk } from "../../../packages/protocol/monitoring-export.js";

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
      | "cleanup"
      | "storage",
    public readonly media: "image" | "recording" = "image",
  ) {
    super(
      reason === "capacity"
        ? `Monitoring ${media} read capacity is busy; retry shortly. Student capture and exam clocks are unchanged`
        : `Monitoring ${media} read refused (${reason}); refresh review and ask the operator to inspect private storage/permissions. Preserve deletion records and protected submissions`,
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
  private async openPrivate(
    attemptID: string,
    leaf: string,
    handles: FileHandle[],
  ) {
    if (
      process.platform !== "linux" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(attemptID) ||
      !/^[a-fA-F0-9-]{36}(?:\.thumb)?\.(?:jpg|ndjson)$/.test(leaf)
    )
      throw new MonitoringMediaError("unsafe-path");
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
    const attempt = await directory(`/proc/self/fd/${root.fd}/${attemptID}`);
    const file = await open(
      `/proc/self/fd/${attempt.fd}/${leaf}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    handles.push(file);
    return file;
  }
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
      // Intentional pinned proc-fd traversal; never follow a restored leaf or
      // parent-directory symlink. NONBLOCK ensures a FIFO cannot stall HTTP.
      const file = await this.openPrivate(
        row.attempt,
        `${row.id}${thumbnail ? ".thumb" : ""}.jpg`,
        handles,
      );
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
      const closed = await Promise.allSettled(handles.map((fd) => fd.close()));
      if (closed.some((result) => result.status === "rejected"))
        throw new MonitoringMediaError("cleanup"); // Keep its bounded slot: close is unconfirmed.
      this.inflight--;
    }
  }

  // A bounded exact-byte export prefix, including a partial/invalid NDJSON tail.
  // Same pinned descriptor throughout; appends beyond its first size are ignored.
  // An independent second prefix hash must match before a file-end is emitted.
  async *recording(
    attempt: string,
    pane: string,
    recordingID: string,
    actor: string,
    signal?: AbortSignal,
  ): AsyncGenerator<
    | { kind: "begin"; bytes: number }
    | { kind: "data"; offset: number; data: Buffer }
    | { kind: "verify"; offset: number; bytes: number }
    | { kind: "end"; bytes: number; sha256: string }
  > {
    z.string().uuid().parse(pane);
    z.string().uuid().parse(recordingID);
    this.assertRetained(attempt);
    if (
      !this.store.db
        .prepare("SELECT 1 FROM recordings WHERE id=? AND attempt=? AND pane=?")
        .get(recordingID, attempt, pane)
    )
      throw Object.assign(
        Error(
          "Recording not found for this attempt; inspect monitoring list --section terminals",
        ),
        { statusCode: 404 },
      );
    if (this.inflight >= 16)
      throw new MonitoringMediaError("capacity", "recording");
    this.inflight++;
    const handles: FileHandle[] = [];
    const check = () => {
      if (signal?.aborted)
        throw Object.assign(
          Error("Monitoring export canceled; private copy is incomplete"),
          { statusCode: 409 },
        );
      this.assertRetained(attempt);
    };
    try {
      const file = await this.openPrivate(attempt, `${pane}.ndjson`, handles);
      const before = await file.stat();
      if (!before.isFile())
        throw new MonitoringMediaError("not-regular", "recording");
      if (before.nlink !== 1)
        throw new MonitoringMediaError("linked", "recording");
      if (before.uid !== process.geteuid?.())
        throw new MonitoringMediaError("storage", "recording");
      if (!Number.isSafeInteger(before.size) || before.size < 0)
        throw new MonitoringMediaError("size", "recording");
      const through = before.size;
      check();
      yield { kind: "begin", bytes: through };
      const part = async (offset: number) => {
        check();
        const data = Buffer.alloc(
          Math.min(monitoringExportChunk, through - offset),
        );
        let count = 0;
        while (count < data.length) {
          const read = await file.read(
            data,
            count,
            data.length - count,
            offset + count,
          );
          check();
          if (!read.bytesRead)
            throw new MonitoringMediaError("changed", "recording");
          count += read.bytesRead;
        }
        return data;
      };
      const exported = createHash("sha256");
      for (let offset = 0; offset < through; ) {
        const data = await part(offset);
        exported.update(data);
        yield { kind: "data", offset, data };
        offset += data.length;
      }
      const sha256 = exported.digest("hex"),
        verify = createHash("sha256");
      let reported = 0,
        reportedAt = Date.now();
      for (let offset = 0; offset < through; ) {
        const data = await part(offset);
        verify.update(data);
        offset += data.length;
        if (
          offset - reported >= 8 * 1024 * 1024 ||
          Date.now() - reportedAt >= 1000
        ) {
          reported = offset;
          reportedAt = Date.now();
          yield { kind: "verify", offset, bytes: through };
        }
      }
      const after = await file.stat();
      check();
      if (
        after.size < through ||
        after.nlink !== 1 ||
        after.uid !== before.uid ||
        verify.digest("hex") !== sha256
      )
        throw new MonitoringMediaError("changed", "recording");
      this.store.audit(
        actor,
        "export-recording-bytes",
        attempt,
        JSON.stringify({ pane, bytes: through }),
      );
      yield { kind: "end", bytes: through, sha256 };
    } catch (error) {
      if (error instanceof MonitoringMediaError)
        throw new MonitoringMediaError(error.reason, "recording");
      if ((error as any)?.statusCode === 410) throw error;
      if (signal?.aborted)
        throw Object.assign(
          Error("Monitoring export canceled; private copy is incomplete"),
          { statusCode: 409 },
        );
      throw new MonitoringMediaError(
        ["ELOOP", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException)?.code || "",
        )
          ? "unsafe-path"
          : "storage",
        "recording",
      );
    } finally {
      const closed = await Promise.allSettled(handles.map((fd) => fd.close()));
      if (closed.some((result) => result.status === "rejected"))
        throw new MonitoringMediaError("cleanup", "recording");
      this.inflight--;
    }
  }
}
