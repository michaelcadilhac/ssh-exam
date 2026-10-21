import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, constants, openSync, fstatSync, closeSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import type { Store } from "./db.js";

export class MonitoringPurgeError extends Error {
  constructor(public readonly code: string) {
    super(
      `Monitoring physical purge ${code}; deletion remains in force. Preserve tombstones and inspect storage/worker diagnostics before retrying`,
    );
  }
}

// Internal process boundary only. Durable scheduling/claims, public deletion
// intents and UI/CLI status are separate work; this is NOT yet wired into app.
export class MonitoringPurgeProcess {
  private active?: {
    child: ChildProcessWithoutNullStreams;
    settled: Promise<unknown>;
  };
  constructor(
    private store: Store,
    private options: { entry?: URL; timeoutMs?: number } = {},
  ) {}
  get pid() {
    return this.active?.child.pid;
  }
  async run(id: string): Promise<{ removed: number }> {
    if (this.active) throw new MonitoringPurgeError("busy");
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))
      throw new MonitoringPurgeError("invalid-target");
    if (
      !this.store.db.prepare("SELECT 1 FROM tombstones WHERE attempt=?").get(id)
    )
      throw new MonitoringPurgeError("requires-durable-deletion");
    const compiled = new URL("./monitoring-purge-worker.js", import.meta.url);
    const entry =
      this.options.entry ??
      (existsSync(fileURLToPath(compiled))
        ? compiled
        : new URL("./monitoring-purge-worker.ts", import.meta.url));
    const nonce = randomBytes(32).toString("hex");
    const request =
      JSON.stringify({
        version: 1,
        id,
        nonce,
        root: resolvePath(this.store.dir, "monitoring"),
      }) + "\n";
    if (Buffer.byteLength(request) > 4096)
      throw new MonitoringPurgeError("request-limit");
    // One persistent inode across coordinators/restarts. Never unlink this lock.
    // Open and validate ourselves, then let no-fork flock lock the pinned inode;
    // the worker inherits the lock until actual exit, including parent death.
    let lock: number;
    try {
      lock = openSync(
        `${this.store.dir}/monitoring-purge.lock`,
        constants.O_CREAT |
          constants.O_RDWR |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK,
        0o600,
      );
    } catch {
      throw new MonitoringPurgeError("unsafe-lock");
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      const info = fstatSync(lock);
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.uid !== process.geteuid?.() ||
        (info.mode & 0o077) !== 0
      )
        throw new MonitoringPurgeError("unsafe-lock");
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
          "--max-old-space-size=32",
          "--v8-pool-size=1",
          "--unhandled-rejections=strict",
          ...(entry.pathname.endsWith(".ts") ? ["--import", "tsx"] : []),
          fileURLToPath(entry),
        ],
        {
          env: {
            PATH: process.env.PATH,
            LANG: "C.UTF-8",
            UV_THREADPOOL_SIZE: "1",
          },
          // stdout is a small framed result; never inherit worker logs or secrets.
          stdio: ["pipe", "pipe", "pipe", lock],
        },
      ) as ChildProcessWithoutNullStreams; // First three descriptors are always pipes.
    } finally {
      closeSync(lock);
    }
    child.stderr.resume(); // Discard even fatal-runtime/private exception text.
    let output = Buffer.alloc(0),
      failure: string | undefined;
    const settled = new Promise<{ removed: number }>((resolve, reject) => {
      const fail = (code: string) => {
        failure ??= code;
        child.kill("SIGKILL");
      };
      const timer = setTimeout(
        () => fail("timeout"),
        this.options.timeoutMs ?? 10000,
      );
      child.stdin.on("error", () => {
        /* Exit/close supplies the terminal result. */
      });
      child.once("error", () => fail("unavailable"));
      child.stdout.on("data", (chunk: Buffer) => {
        if (output.length + chunk.length > 8192) return fail("protocol");
        output = Buffer.concat([output, chunk]);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        child.stdin.destroy();
        if (failure || code !== 0 || signal)
          return reject(
            new MonitoringPurgeError(
              failure ?? (code === 75 ? "busy" : "worker-exit"),
            ),
          );
        try {
          const value = JSON.parse(output.toString("utf8"));
          if (
            value.version !== 1 ||
            value.id !== id ||
            value.nonce !== nonce ||
            !["removed", "refused"].includes(value.status)
          )
            throw Error();
          const fields = Object.keys(value).sort().join(",");
          if (
            fields !==
            (value.status === "removed"
              ? "id,nonce,removed,status,version"
              : "code,id,nonce,status,version")
          )
            throw Error();
          if (value.status === "refused") {
            const allowed = [
              "unsafe-root",
              "unsafe-target",
              "unexpected-directory",
              "permission",
              "storage",
              "protocol",
            ];
            return reject(
              new MonitoringPurgeError(
                allowed.includes(value.code) ? value.code : "protocol",
              ),
            );
          }
          if (!Number.isSafeInteger(value.removed) || value.removed < 0)
            throw Error();
          // A valid child reply is not by itself a physical-removal receipt.
          // Verify the private root and absence independently, asynchronously;
          // do not block the HTTP event loop on storage or trust a forged success.
          void (async () => {
            const root = resolvePath(this.store.dir, "monitoring");
            const info = await lstat(root);
            if (
              !info.isDirectory() ||
              info.uid !== process.geteuid?.() ||
              (info.mode & 0o077) !== 0
            )
              throw Error();
            try {
              await lstat(`${root}/${id}`);
            } catch (error) {
              if ((error as any).code === "ENOENT") return;
              throw error;
            }
            throw Error();
          })().then(
            () => resolve({ removed: value.removed }),
            () => reject(new MonitoringPurgeError("unverified")),
          );
        } catch {
          reject(new MonitoringPurgeError("protocol"));
        }
      });
    });
    this.active = { child, settled };
    // Keep stdin open after the request: EOF detects coordinator death in the
    // child. No generic command, file contents, DB path or credentials are sent.
    child.stdin.write(request);
    try {
      return await settled;
    } finally {
      if (this.active?.child === child) this.active = undefined;
    }
  }
  async close() {
    const active = this.active;
    if (!active) return;
    active.child.kill("SIGKILL"); // Only this supervisor's exact owned child.
    await active.settled.catch(() => {});
  }
}
