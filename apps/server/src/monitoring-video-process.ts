import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  constants,
  existsSync,
  openSync,
  fstatSync,
  closeSync,
  type Stats,
} from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve, isAbsolute } from "node:path";
import { z } from "zod";
import type { Store } from "./db.js";
import {
  videoRunInput,
  videoFrameInput,
  videoFramesInput,
  videoResult,
  type VideoRunInput,
  type VideoFrameInput,
  type VideoResult,
  type VideoFramesInput,
  type VideoRenderedFrame,
} from "./monitoring-video-schema.js";
export type {
  VideoRunInput,
  VideoFrameInput,
  VideoResult,
  VideoFramesInput,
  VideoRenderedFrame,
} from "./monitoring-video-schema.js";

export class MonitoringVideoError extends Error {
  constructor(
    public readonly code: string,
    public readonly signal?: NodeJS.Signals | null,
  ) {
    super(
      "Monitoring video " +
        code +
        "; preserve original captures and inspect the archive job before retrying. Live monitoring and exam authority are unchanged",
    );
  }
}
const failures = new Set([
  "unsafe-root",
  "unsafe-target",
  "source-digest",
  "source-changed",
  "sync-changed",
  "dimensions",
  "codec",
  "validation",
  "digest",
  "storage",
  "protocol",
  "capacity",
]);
const directoryFlags =
  constants.O_RDONLY |
  constants.O_DIRECTORY |
  constants.O_NOFOLLOW |
  constants.O_NONBLOCK;
function privateInfo(info: Stats, directory = false) {
  return (
    (directory ? info.isDirectory() : info.isFile() && info.nlink === 1) &&
    info.uid === process.geteuid?.() &&
    (info.mode & 0o077) === 0
  );
}

// One global encoder and two independent review slots. A dead coordinator cannot
// release an active child's flock; killing this owned process group contains all
// codec descendants. No SQL, credentials or original deletion are delegated.
export class MonitoringVideoProcess {
  private stopped = false;
  private ensureOpen() {
    if (this.stopped) throw new MonitoringVideoError("closed");
  }
  private active = new Set<{
    child: ChildProcessWithoutNullStreams;
    settled: Promise<unknown>;
  }>();
  constructor(
    private store: Store,
    private options: { entry?: URL; timeoutMs?: number } = {},
  ) {}
  get pids() {
    return [...this.active].map((job) => job.child.pid);
  }
  get pid() {
    return this.pids[0];
  }
  private eligible(attempt: string) {
    const a = this.store.db
      .prepare("SELECT state,start,ended FROM attempts WHERE id=?")
      .get(attempt) as
      | { state: string; start: number | null; ended: number | null }
      | undefined;
    if (
      !a ||
      a.state !== "COMPLETED" ||
      a.start === null ||
      a.ended === null ||
      this.store.db
        .prepare("SELECT 1 FROM tombstones WHERE attempt=?")
        .get(attempt)
    )
      throw new MonitoringVideoError("requires-completed-retained-attempt");
  }
  async run(input: VideoRunInput): Promise<VideoResult> {
    this.ensureOpen();
    const parsed = videoRunInput.safeParse(input);
    if (!parsed.success) throw new MonitoringVideoError("invalid-request");
    const value = parsed.data;
    this.eligible(value.attempt);
    const root = resolve(this.store.dir, "monitoring");
    if (
      !isAbsolute(value.work) ||
      value.work !== join(root, value.attempt, ".video-work-" + value.segment)
    )
      throw new MonitoringVideoError("unsafe-target");
    const output = await this.dispatch("encode", value, ["encode"]);
    const result = videoResult.safeParse(output);
    if (!result.success) throw new MonitoringVideoError("protocol");
    const r = result.data;
    const first = value.frames[0],
      edge = value.source === "screen" ? 1280 : 320;
    const scale = Math.min(1, edge / Math.max(first.width, first.height));
    const scaledWidth = Math.max(1, Math.round(first.width * scale)),
      scaledHeight = Math.max(1, Math.round(first.height * scale)),
      width = scaledWidth + (scaledWidth % 2),
      height = scaledHeight + (scaledHeight % 2);
    if (
      r.attempt !== value.attempt ||
      r.segment !== value.segment ||
      r.source !== value.source ||
      r.file !== value.segment + ".webm" ||
      r.width !== width ||
      r.height !== height ||
      r.duration_ms !== value.frames.length * 5000 ||
      r.frames.length !== value.frames.length ||
      r.frames.some(
        (frame, index) =>
          frame.id !== value.frames[index].id ||
          frame.original_hash !== value.frames[index].hash ||
          frame.captured !== value.frames[index].captured ||
          frame.index !== index ||
          frame.presentation_ms !== index * 5000,
      )
    )
      throw new MonitoringVideoError("protocol");
    await this.verifyOutput(value, r);
    this.ensureOpen();
    this.eligible(value.attempt);
    return r;
  }
  // A separate PID is essential: closing a DB descriptor in this coordinator
  // could release SQLite's process-owned POSIX locks. This child performs no SQL.
  async sync(): Promise<void> {
    this.ensureOpen();
    const result = await this.dispatch("sync", {}, ["encode"]);
    if (
      !z
        .object({ synced: z.literal(true) })
        .strict()
        .safeParse(result).success
    )
      throw new MonitoringVideoError("protocol");
    this.ensureOpen();
  }
  async frame(input: VideoFrameInput): Promise<Buffer> {
    this.ensureOpen();
    const parsed = videoFrameInput.safeParse(input);
    if (!parsed.success) throw new MonitoringVideoError("invalid-request");
    const value = parsed.data;
    const result = await this.frames({
      attempt: value.attempt,
      segment: value.segment,
      sha256: value.sha256,
      width: value.width,
      height: value.height,
      frames: [{ index: value.index, decoded_sha256: value.decoded_sha256 }],
    });
    return value.thumbnail ? result[0].thumbnail : result[0].original;
  }
  async frames(input: VideoFramesInput): Promise<VideoRenderedFrame[]> {
    this.ensureOpen();
    const parsed = videoFramesInput.safeParse(input);
    if (!parsed.success) throw new MonitoringVideoError("invalid-request");
    this.eligible(parsed.data.attempt);
    const output = await this.dispatch("frames", parsed.data, [
      "read-0",
      "read-1",
    ]);
    const result = z
      .object({
        frames: z
          .array(
            z
              .object({
                index: z.number().int().min(0).max(11),
                original: z.string().max(2100000),
                thumbnail: z.string().max(2100000),
              })
              .strict(),
          )
          .min(1)
          .max(12),
      })
      .strict()
      .safeParse(output);
    if (
      !result.success ||
      result.data.frames.length !== parsed.data.frames.length ||
      result.data.frames.some(
        (frame, index) => frame.index !== parsed.data.frames[index].index,
      )
    )
      throw new MonitoringVideoError("protocol");
    const decode = (data: string) => {
      const bytes = Buffer.from(data, "base64");
      if (
        !bytes.length ||
        bytes.length > 1500000 ||
        bytes.toString("base64") !== data ||
        bytes[0] !== 255 ||
        bytes[1] !== 216
      )
        throw new MonitoringVideoError("protocol");
      return bytes;
    };
    const frames = result.data.frames.map((frame) => ({
      index: frame.index,
      original: decode(frame.original),
      thumbnail: decode(frame.thumbnail),
    }));
    this.ensureOpen();
    this.eligible(parsed.data.attempt);
    return frames;
  }
  private async verifyOutput(
    input: z.output<typeof videoRunInput>,
    result: VideoResult,
  ) {
    const handles: FileHandle[] = [];
    try {
      const root = await open(
        resolve(this.store.dir, "monitoring"),
        directoryFlags,
      );
      handles.push(root);
      const attempt = await open(
        "/proc/self/fd/" + root.fd + "/" + input.attempt,
        directoryFlags,
      );
      handles.push(attempt);
      const stage = await open(
        "/proc/self/fd/" + attempt.fd + "/.video-work-" + input.segment,
        directoryFlags,
      );
      handles.push(stage);
      for (const handle of handles)
        if (!privateInfo(await handle.stat(), true))
          throw new MonitoringVideoError("unsafe-target");
      const file = await open(
        "/proc/self/fd/" + stage.fd + "/" + result.file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      handles.push(file);
      const before = await file.stat();
      if (!privateInfo(before) || before.size !== result.bytes)
        throw new MonitoringVideoError("validation");
      const digest = createHash("sha256"),
        buffer = Buffer.alloc(128 * 1024);
      let position = 0;
      while (true) {
        const read = await file.read(buffer, 0, buffer.length, position);
        if (!read.bytesRead) break;
        position += read.bytesRead;
        if (position > result.bytes)
          throw new MonitoringVideoError("validation");
        digest.update(buffer.subarray(0, read.bytesRead));
      }
      const after = await file.stat();
      if (
        position !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs ||
        after.nlink !== 1 ||
        digest.digest("hex") !== result.sha256
      )
        throw new MonitoringVideoError("digest");
    } catch (error) {
      if (error instanceof MonitoringVideoError) throw error;
      throw new MonitoringVideoError("storage");
    } finally {
      for (const handle of handles.reverse())
        await handle.close().catch(() => {});
    }
  }
  private async dispatch(
    operation: "encode" | "frames" | "sync",
    input: unknown,
    slots: string[],
  ): Promise<unknown> {
    for (const slot of slots) {
      try {
        return await this.child(operation, input, slot);
      } catch (error) {
        if (
          !(error instanceof MonitoringVideoError) ||
          error.code !== "capacity"
        )
          throw error;
      }
    }
    throw new MonitoringVideoError("capacity");
  }
  private child(
    operation: "encode" | "frames" | "sync",
    input: unknown,
    slot: string,
  ): Promise<unknown> {
    this.ensureOpen();
    const compiled = new URL("./monitoring-video-worker.js", import.meta.url);
    const entry =
      this.options.entry ??
      (existsSync(fileURLToPath(compiled))
        ? compiled
        : new URL("./monitoring-video-worker.ts", import.meta.url));
    const nonce = randomBytes(32).toString("hex");
    const request =
      JSON.stringify({
        version: 1,
        nonce,
        operation,
        root: resolve(this.store.dir, "monitoring"),
        input,
      }) + "\n";
    if (Buffer.byteLength(request) > 16384)
      return Promise.reject(new MonitoringVideoError("invalid-request"));
    let lock: number;
    try {
      lock = openSync(
        join(this.store.dir, "monitoring-video-" + slot + ".lock"),
        constants.O_CREAT |
          constants.O_RDWR |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK,
        0o600,
      );
    } catch {
      return Promise.reject(new MonitoringVideoError("unsafe-lock"));
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      if (!privateInfo(fstatSync(lock)))
        throw new MonitoringVideoError("unsafe-lock");
      child = spawn(
        "/usr/bin/flock",
        [
          "--exclusive",
          "--nonblock",
          "--no-fork",
          "--conflict-exit-code",
          "75",
          "/proc/self/fd/3",
          process.execPath,
          "--max-old-space-size=96",
          "--v8-pool-size=1",
          "--unhandled-rejections=strict",
          ...(entry.pathname.endsWith(".ts") ? ["--import", "tsx"] : []),
          fileURLToPath(entry),
        ],
        {
          detached: true,
          env: {
            PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
            LANG: "C.UTF-8",
            UV_THREADPOOL_SIZE: "1",
          },
          stdio: ["pipe", "pipe", "pipe", lock],
        },
      ) as ChildProcessWithoutNullStreams;
    } catch (error) {
      return Promise.reject(
        error instanceof MonitoringVideoError
          ? error
          : new MonitoringVideoError("unavailable"),
      );
    } finally {
      closeSync(lock);
    }
    child.stderr.resume();
    const chunks: Buffer[] = [];
    let outputSize = 0,
      failure: string | undefined;
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        /* exact owned group already exited */
      }
    };
    const settled = new Promise<unknown>((resolveResult, reject) => {
      const fail = (code: string) => {
        failure ??= code;
        kill();
      };
      const timer = setTimeout(
        () => fail("timeout"),
        this.options.timeoutMs ?? 60000,
      );
      child.stdin.on("error", () => {});
      child.once("error", () => fail("unavailable"));
      child.stdout.on("data", (chunk: Buffer) => {
        outputSize += chunk.length;
        if (outputSize > (operation === "frames" ? 16 * 1024 * 1024 : 65536))
          return fail("protocol");
        chunks.push(chunk);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        kill(); // No codec descendant may outlive even a successful worker.
        child.stdin.destroy();
        if (failure || code !== 0 || signal)
          return reject(
            new MonitoringVideoError(
              failure ?? (code === 75 ? "capacity" : "worker-exit"),
              signal,
            ),
          );
        try {
          const parsed = z
            .union([
              z
                .object({
                  version: z.literal(1),
                  nonce: z.literal(nonce),
                  status: z.literal("complete"),
                  result: z.unknown(),
                })
                .strict(),
              z
                .object({
                  version: z.literal(1),
                  nonce: z.literal(nonce),
                  status: z.literal("refused"),
                  code: z.string(),
                })
                .strict(),
            ])
            .parse(
              JSON.parse(Buffer.concat(chunks, outputSize).toString("utf8")),
            );
          if (parsed.status === "refused")
            return reject(
              new MonitoringVideoError(
                failures.has(parsed.code) ? parsed.code : "protocol",
              ),
            );
          resolveResult(parsed.result);
        } catch {
          reject(new MonitoringVideoError("protocol"));
        }
      });
    });
    const job = { child, settled };
    this.active.add(job);
    child.stdin.write(request);
    void settled.finally(() => this.active.delete(job)).catch(() => {});
    return settled;
  }
  async close() {
    this.stopped = true;
    const jobs = [...this.active];
    for (const job of jobs)
      try {
        if (job.child.pid) process.kill(-job.child.pid, "SIGKILL");
      } catch {
        /* owned group already closed */
      }
    await Promise.allSettled(jobs.map((job) => job.settled));
  }
}
