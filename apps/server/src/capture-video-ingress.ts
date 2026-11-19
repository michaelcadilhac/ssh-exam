import { accessSync, constants } from "node:fs";
import type { CaptureUploadMetadata } from "../../../packages/protocol/capture-upload.js";
import { captureDigest, withCaptureReceipt } from "./capture-upload-receipt.js";

import {
  CaptureVideoWorker,
  CaptureVideoUnavailable,
  type CaptureVideoStage,
} from "./capture-video-codec.js";
export { CaptureVideoUnavailable };
export type { CaptureVideoStage };

type SourceContext = {
  channel: string;
  scope: string;
  touched: number;
  retired: boolean;
  worker?: CaptureVideoWorker;
};

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
  private jobs = new Set<symbol>();
  private workers = new Set<CaptureVideoWorker>();
  // Retain the most expensive streams; overflow still decodes independently
  // from its verified prefix. Small camera streams cost much less to rebuild.
  private retained = new Map<CaptureVideoWorker, number>();
  private contexts = new Map<string, SourceContext>();
  private scopes = new Map<string, SourceContext>();
  private requests = new Set<Promise<void>>();
  private slots = 0;
  private waiting: {
    resolve: () => void;
    reject: (stage?: CaptureVideoStage) => void;
  }[] = [];
  private stopped = false;
  get active() {
    return this.jobs.size;
  }
  get pids() {
    return [...this.workers].flatMap((worker) =>
      worker.pid ? [worker.pid] : [],
    );
  }
  private retireWorker(context: SourceContext) {
    const worker = context.worker;
    context.worker = undefined;
    if (worker) {
      this.retained.delete(worker);
      void worker.close();
    }
  }
  private retireContext(context: SourceContext) {
    context.retired = true;
    this.retireWorker(context);
    this.groups.delete(context.scope);
    if (this.contexts.get(context.channel) === context)
      this.contexts.delete(context.channel);
    if (this.scopes.get(context.scope) === context)
      this.scopes.delete(context.scope);
  }
  private current(context: SourceContext) {
    return (
      !this.stopped &&
      !context.retired &&
      this.contexts.get(context.channel) === context
    );
  }
  private context(channel: string, scope: string) {
    const old = this.contexts.get(channel);
    if (old?.scope === scope && !old.retired) {
      old.touched = performance.now();
      return old;
    }
    if (old) this.retireContext(old);
    while (this.contexts.size >= 128) {
      const idle = [...this.contexts.values()].find(
        (entry) => !this.busy.has(entry.scope),
      );
      if (!idle)
        throw new CaptureVideoUnavailable(undefined, "ingress-capacity");
      this.retireContext(idle);
    }
    const context: SourceContext = {
      channel,
      scope,
      touched: performance.now(),
      retired: false,
    };
    this.contexts.set(channel, context);
    this.scopes.set(scope, context);
    return context;
  }
  private prune() {
    const now = performance.now();
    for (const context of this.contexts.values())
      if (now - context.touched > 120_000 && !this.busy.has(context.scope))
        this.retireContext(context);
    for (const [key, value] of this.groups)
      if (now - value.touched > 120_000) {
        this.groups.delete(key);
        const context = this.scopes.get(key);
        if (context) this.retireContext(context);
      }
    let bytes = [...this.groups.values()].reduce(
      (n, g) => n + g.jpeg.length + g.packets.reduce((a, p) => a + p.length, 0),
      0,
    );
    for (const [key, value] of this.groups) {
      if (this.groups.size < 128 && bytes < 64 * 1024 * 1024) break;
      this.groups.delete(key);
      const context = this.scopes.get(key);
      if (context) this.retireContext(context);
      bytes -=
        value.jpeg.length + value.packets.reduce((a, p) => a + p.length, 0);
    }
  }
  private async processRoom() {
    if (this.workers.size < 16) return;
    // A verified idle prefix remains reconstructible when its process is
    // reclaimed. Never evict a source whose decode/publication is in flight.
    const idle = [...this.contexts.values()]
      .filter((entry) => entry.worker && !this.busy.has(entry.scope))
      .sort((a, b) => a.touched - b.touched)[0];
    const retiring = [...this.workers].find((worker) => !worker.live);
    const worker = idle?.worker ?? retiring;
    if (!worker)
      throw new CaptureVideoUnavailable(undefined, "ingress-capacity");
    if (idle?.worker === worker) this.retireWorker(idle);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        worker.done,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1000);
          timer.unref();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (this.workers.size >= 16)
      throw new CaptureVideoUnavailable(undefined, "ingress-capacity");
  }
  private retain(worker: CaptureVideoWorker, pixels: number) {
    const charge = (pixels: number) => 16 * 1024 * 1024 + pixels * 12;
    const budget = 8 * charge(1280 * 720);
    while (
      this.retained.size >= 8 ||
      [...this.retained.values()].reduce(
        (sum, pixels) => sum + charge(pixels),
        0,
      ) +
        charge(pixels) >
        budget
    ) {
      const idle = [...this.contexts.values()]
        .filter(
          (entry) =>
            entry.worker &&
            this.retained.has(entry.worker) &&
            !this.busy.has(entry.scope),
        )
        .sort(
          (a, b) =>
            this.retained.get(a.worker!)! - this.retained.get(b.worker!)!,
        )[0];
      if (!idle || this.retained.get(idle.worker!)! >= pixels) return;
      this.retireWorker(idle);
    }
    this.retained.set(worker, pixels);
  }
  async accept<T>(
    scope: string,
    metadata: CaptureUploadMetadata,
    packet: Buffer,
    publish: (jpeg: Buffer) => Promise<T>,
    channel = scope,
  ): Promise<T> {
    this.prune();
    const v = metadata.video;
    if (this.stopped) throw new CaptureVideoUnavailable(undefined, "closed");
    if (!this.available) throw new CaptureVideoUnavailable();
    if (!v) throw new CaptureVideoUnavailable(undefined, "missing-video");
    if (this.busy.has(scope))
      throw new CaptureVideoUnavailable(undefined, "source-busy");
    if (this.busy.size >= 64)
      throw new CaptureVideoUnavailable(undefined, "ingress-capacity");
    this.busy.add(scope);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.requests.add(pending);
    let context: SourceContext | undefined;
    let fed = false;
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
        throw new CaptureVideoUnavailable(undefined, "prediction-chain");
      const packets = v.key ? [packet] : [...prior!.packets, packet];
      if (
        packets.length > 12 ||
        packets.reduce((n, p) => n + p.length, 0) > 4 * 1024 * 1024
      )
        throw new CaptureVideoUnavailable(undefined, "prediction-limit");
      context = this.context(channel, scope);
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
        decoded = await this.slot(() => {
          if (!this.current(context!))
            throw new CaptureVideoUnavailable(undefined, "prediction-chain");
          fed = true;
          return this.decode(ivf, packets.length - 1, context!);
        });
      if (!this.current(context))
        throw new CaptureVideoUnavailable(undefined, "prediction-chain");
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
      if (this.current(context)) {
        context.touched = performance.now();
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
    } catch (error) {
      // The process can have consumed bytes that publication did not accept.
      // Keep only the prior VERIFIED prefix; never continue speculative state.
      if (fed && context) this.retireWorker(context);
      throw error;
    } finally {
      this.busy.delete(scope);
      this.requests.delete(pending);
      finish();
    }
  }
  private async slot<T>(work: () => Promise<T>): Promise<T> {
    if (this.stopped) throw new CaptureVideoUnavailable(undefined, "closed");
    if (this.slots >= 4)
      await new Promise<void>((resolve, reject) => {
        const waiter = {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (stage: CaptureVideoStage = "closed") => {
            clearTimeout(timer);
            reject(new CaptureVideoUnavailable(undefined, stage));
          },
        };
        const timer = setTimeout(() => {
          const index = this.waiting.indexOf(waiter);
          if (index !== -1) this.waiting.splice(index, 1);
          waiter.reject("queue-timeout");
        }, 5000);
        this.waiting.push(waiter);
      });
    else this.slots++;
    try {
      if (this.stopped) throw new CaptureVideoUnavailable(undefined, "closed");
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next.resolve();
      else this.slots--;
    }
  }
  private async decode(
    ivf: Buffer,
    index: number,
    context: SourceContext,
  ): Promise<Buffer> {
    const job = Symbol();
    this.jobs.add(job);
    try {
      let worker = context.worker;
      if (index === 0 || !worker?.live || worker.frames !== index) {
        this.retireWorker(context);
        if (this.workers.size >= 16) await this.processRoom();
        if (!this.current(context))
          throw new CaptureVideoUnavailable(undefined, "prediction-chain");
        worker = new CaptureVideoWorker(context.scope, index);
        context.worker = worker;
        this.workers.add(worker);
        this.retain(worker, ivf.readUInt16LE(12) * ivf.readUInt16LE(14));
        void worker.done.then(() => {
          this.workers.delete(worker!);
          this.retained.delete(worker!);
        });
      }
      const jpeg = await worker.frame(ivf, index);
      if (!this.retained.has(worker)) {
        if (context.worker === worker) context.worker = undefined;
        await worker.close();
      }
      return jpeg;
    } finally {
      this.jobs.delete(job);
    }
  }
  async close() {
    this.stopped = true;
    this.groups.clear();
    for (const waiter of this.waiting.splice(0)) waiter.reject();
    for (const context of this.contexts.values()) this.retireContext(context);
    const workers = [...this.workers];
    for (const worker of workers) void worker.close();
    await Promise.all(workers.map((worker) => worker.done));
    await Promise.all([...this.requests]);
  }
}
