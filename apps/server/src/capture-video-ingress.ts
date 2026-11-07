import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import type { CaptureUploadMetadata } from "../../../packages/protocol/capture-upload.js";
import { captureDigest, withCaptureReceipt } from "./capture-upload-receipt.js";

export class CaptureVideoUnavailable extends Error {
  readonly statusCode = 409;
  readonly code = "capture_video_reset";
  constructor(readonly signal?: NodeJS.Signals) {
    super(
      "Take a fresh JPEG capture; video verification is temporarily unavailable",
    );
  }
}
type Group = {
  chain: string;
  width: number;
  height: number;
  packets: Buffer[];
  digest: string;
  fingerprint: string;
  jpeg: Buffer;
  touched: number;
};

// No files, SQL, signing keys or new execution authority belong to this decoder.
// Each native codec invocation has independent address/CPU/output/time bounds.
export class CaptureVideoIngress {
  readonly available = (() => {
    try {
      if (process.platform !== "linux") return false;
      for (const path of ["/usr/bin/prlimit", "/usr/bin/ffmpeg"])
        accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  })();
  private groups = new Map<string, Group>();
  private busy = new Set<string>();
  private jobs = new Set<{
    pid: number | undefined;
    kill: () => void;
    done: Promise<void>;
  }>();
  private requests = new Set<Promise<void>>();
  private slots = 0;
  private waiting: { resolve: () => void; reject: () => void }[] = [];
  private stopped = false;
  get active() {
    return this.jobs.size;
  }
  get pids() {
    return [...this.jobs].flatMap((job) => (job.pid ? [job.pid] : []));
  }
  private prune() {
    const now = performance.now();
    for (const [key, value] of this.groups)
      if (now - value.touched > 120_000) this.groups.delete(key);
    let bytes = [...this.groups.values()].reduce(
      (n, g) => n + g.jpeg.length + g.packets.reduce((a, p) => a + p.length, 0),
      0,
    );
    for (const [key, value] of this.groups) {
      if (this.groups.size < 128 && bytes < 64 * 1024 * 1024) break;
      this.groups.delete(key);
      bytes -=
        value.jpeg.length + value.packets.reduce((a, p) => a + p.length, 0);
    }
  }
  async accept<T>(
    scope: string,
    metadata: CaptureUploadMetadata,
    packet: Buffer,
    publish: (jpeg: Buffer) => Promise<T>,
  ): Promise<T> {
    this.prune();
    const v = metadata.video;
    if (
      this.stopped ||
      !this.available ||
      !v ||
      this.busy.has(scope) ||
      this.busy.size >= 64
    )
      throw new CaptureVideoUnavailable();
    this.busy.add(scope);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.requests.add(pending);
    try {
      const fingerprint = captureDigest(
        Buffer.concat([Buffer.from(JSON.stringify(metadata)), packet]),
      );
      const prior = this.groups.get(scope);
      if (prior?.fingerprint === fingerprint) return await publish(prior.jpeg);
      if (
        !v.key &&
        (!prior ||
          prior.chain !== v.chain ||
          prior.digest !== v.previous ||
          prior.width !== v.width ||
          prior.height !== v.height)
      )
        throw new CaptureVideoUnavailable();
      const packets = v.key ? [packet] : [...prior!.packets, packet];
      if (
        packets.length > 12 ||
        packets.reduce((n, p) => n + p.length, 0) > 4 * 1024 * 1024
      )
        throw new CaptureVideoUnavailable();
      const header = Buffer.alloc(32);
      header.write("DKIF");
      header.writeUInt16LE(32, 6);
      header.write("VP90", 8);
      header.writeUInt16LE(v.width, 12);
      header.writeUInt16LE(v.height, 14);
      header.writeUInt32LE(1, 16);
      header.writeUInt32LE(5, 20);
      header.writeUInt32LE(packets.length, 24);
      const parts: Buffer[] = [header];
      for (let index = 0; index < packets.length; index++) {
        const prefix = Buffer.alloc(12);
        prefix.writeUInt32LE(packets[index].length);
        prefix.writeBigUInt64LE(BigInt(index), 4);
        parts.push(prefix, packets[index]);
      }
      const ivf = Buffer.concat(parts),
        decoded = await this.slot(() => this.decode(ivf, packets.length - 1));
      if (this.stopped) throw new CaptureVideoUnavailable();
      const initial = captureDigest(decoded);
      const jpeg = withCaptureReceipt(decoded, {
        encoding: "vp9-upload-v1",
        packet_sha256: captureDigest(packet),
        prediction_sha256: captureDigest(ivf),
        metadata_sha256: captureDigest(Buffer.from(JSON.stringify(metadata))),
        initial_jpeg_sha256: initial,
        representation_jpeg_sha256: initial,
      });
      const result = await publish(jpeg);
      if (!this.stopped) {
        this.groups.delete(scope);
        this.groups.set(scope, {
          chain: v.chain,
          width: v.width,
          height: v.height,
          packets,
          digest: captureDigest(packet),
          fingerprint,
          jpeg,
          touched: performance.now(),
        });
        this.prune();
      }
      return result;
    } finally {
      this.busy.delete(scope);
      this.requests.delete(pending);
      finish();
    }
  }
  private async slot<T>(work: () => Promise<T>): Promise<T> {
    if (this.stopped) throw new CaptureVideoUnavailable();
    if (this.slots >= 4)
      await new Promise<void>((resolve, reject) => {
        const waiter = {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: () => {
            clearTimeout(timer);
            reject(new CaptureVideoUnavailable());
          },
        };
        const timer = setTimeout(() => {
          const index = this.waiting.indexOf(waiter);
          if (index !== -1) this.waiting.splice(index, 1);
          waiter.reject();
        }, 5000);
        this.waiting.push(waiter);
      });
    else this.slots++;
    try {
      if (this.stopped) throw new CaptureVideoUnavailable();
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next.resolve();
      else this.slots--;
    }
  }
  private decode(ivf: Buffer, index: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "/usr/bin/prlimit",
        [
          "--as=1073741824",
          "--cpu=8",
          "--fsize=2097152",
          "--",
          "/usr/bin/ffmpeg",
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-max_alloc",
          "33554432",
          "-max_pixels",
          "1638400",
          "-err_detect",
          "explode",
          "-threads",
          "1",
          "-filter_threads",
          "1",
          "-protocol_whitelist",
          "pipe",
          "-f",
          "ivf",
          "-i",
          "pipe:0",
          "-an",
          "-sn",
          "-dn",
          "-vf",
          `select=eq(n\\,${index})`,
          "-frames:v",
          "1",
          "-c:v",
          "mjpeg",
          "-q:v",
          "4",
          "-threads",
          "1",
          "-f",
          "image2pipe",
          "pipe:1",
        ],
        {
          detached: true,
          stdio: ["pipe", "pipe", "ignore"],
          env: { PATH: "/usr/bin", LANG: "C" },
        },
      );
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      const job = {
        pid: child.pid,
        kill: () => {
          try {
            if (child.pid) process.kill(-child.pid, "SIGKILL");
          } catch {}
        },
        done,
      };
      this.jobs.add(job);
      const timer = setTimeout(job.kill, 15_000),
        parts: Buffer[] = [];
      let bytes = 0;
      child.stdout.on("data", (part: Buffer) => {
        bytes += part.length;
        if (bytes > 1_490_000) job.kill();
        else parts.push(part);
      });
      child.stdin.on("error", () => {});
      child.once("error", () => {
        clearTimeout(timer);
        this.jobs.delete(job);
        resolveDone();
        reject(new CaptureVideoUnavailable());
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        this.jobs.delete(job);
        resolveDone();
        if (code !== 0 || signal || bytes < 32 || bytes > 1_490_000)
          reject(new CaptureVideoUnavailable(signal ?? undefined));
        else resolve(Buffer.concat(parts));
      });
      child.stdin.end(ivf);
    });
  }
  async close() {
    this.stopped = true;
    this.groups.clear();
    for (const waiter of this.waiting.splice(0)) waiter.reject();
    const jobs = [...this.jobs];
    for (const job of jobs) job.kill();
    await Promise.all(jobs.map((job) => job.done));
    await Promise.all([...this.requests]);
  }
}
