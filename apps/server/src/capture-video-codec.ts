import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type CaptureVideoStage =
  | "unavailable"
  | "closed"
  | "missing-video"
  | "source-busy"
  | "ingress-capacity"
  | "prediction-chain"
  | "prediction-limit"
  | "queue-timeout"
  | "codec-spawn"
  | "codec-timeout"
  | "codec-output"
  | "codec-signal"
  | "codec-exit";

export class CaptureVideoUnavailable extends Error {
  readonly statusCode = 409;
  readonly code = "capture_video_reset";
  constructor(
    readonly signal?: NodeJS.Signals,
    readonly stage: CaptureVideoStage = "unavailable",
  ) {
    super(
      "Take a fresh JPEG capture; video verification is temporarily unavailable",
    );
  }
}

// This is framing validation, not a decoder. An uploaded VP9 chunk may include
// invisible reference frames, but must produce exactly one displayed image.
// Otherwise a second output could be mistaken for the next request's image.
// WebM VP9 superframe/uncompressed-header specification, sections3 and4.
function displayedFrames(packet: Buffer): number {
  if (!packet.length)
    throw new CaptureVideoUnavailable(undefined, "codec-exit");
  const marker = packet[packet.length - 1];
  let frames: Buffer[] = [packet];
  if ((marker & 0xe0) === 0xc0) {
    const count = (marker & 7) + 1,
      magnitude = ((marker >> 3) & 3) + 1;
    const end = packet.length - 2 - count * magnitude;
    if (end < 0 || packet[end] !== marker)
      throw new CaptureVideoUnavailable(undefined, "codec-exit");
    frames = [];
    let offset = 0;
    for (let index = 0; index < count; index++) {
      const size = packet.readUIntLE(end + 1 + index * magnitude, magnitude);
      if (!size || offset + size > end)
        throw new CaptureVideoUnavailable(undefined, "codec-exit");
      frames.push(packet.subarray(offset, offset + size));
      offset += size;
    }
    if (offset !== end)
      throw new CaptureVideoUnavailable(undefined, "codec-exit");
  }
  let displayed = 0;
  for (const frame of frames) {
    const byte = frame[0];
    if (byte >> 6 !== 2)
      throw new CaptureVideoUnavailable(undefined, "codec-exit");
    const profile = ((byte >> 5) & 1) + 2 * ((byte >> 4) & 1);
    const reserved = profile === 3 ? 1 : 0;
    if (reserved && byte & 8)
      throw new CaptureVideoUnavailable(undefined, "codec-exit");
    const existing = (byte >> (3 - reserved)) & 1;
    if (existing && reserved && frame.length < 2)
      throw new CaptureVideoUnavailable(undefined, "codec-exit");
    displayed += existing || (byte >> (1 - reserved)) & 1 ? 1 : 0;
  }
  return displayed;
}

type PendingFrame = {
  index: number;
  parts: Buffer[];
  bytes: number;
  previousByte: number;
  written: boolean;
  jpeg?: Buffer;
  timer: NodeJS.Timeout;
  resolve: (jpeg: Buffer) => void;
  reject: (error: Error) => void;
};

// One process belongs to one exact source/owner/prediction context. No files,
// networking, SQL, signing material or execution permission live in this worker.
export class CaptureVideoWorker {
  readonly pid: number | undefined;
  readonly done: Promise<void>;
  private child: ChildProcessWithoutNullStreams;
  private pending?: PendingFrame;
  private resolveDone!: () => void;
  private exited = false;
  private closed = false;
  private initialized = false;
  private lifetime: NodeJS.Timeout;
  private framesRead = 0;
  failure?: CaptureVideoUnavailable;

  constructor(
    readonly scope: string,
    private bootstrap: number,
  ) {
    this.done = new Promise<void>((resolve) => {
      this.resolveDone = resolve;
    });
    this.child = spawn(
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
        "-probesize",
        "32",
        "-analyzeduration",
        "0",
        "-fpsprobesize",
        "0",
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
        `select=gte(n\\,${bootstrap})`,
        "-fps_mode",
        "passthrough",
        "-c:v",
        "mjpeg",
        "-q:v",
        "4",
        "-threads",
        "1",
        "-flush_packets",
        "1",
        "-f",
        "image2pipe",
        "pipe:1",
      ],
      {
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { PATH: "/usr/bin", LANG: "C" },
      },
    );
    this.pid = this.child.pid;
    this.lifetime = setTimeout(() => this.fail("codec-timeout"), 120_000);
    this.lifetime.unref();
    this.child.stdout.on("data", (part: Buffer) => this.output(part));
    // Error-level codec diagnostics refuse promptly; never retain untrusted
    // stderr, wait for another input packet, or expose it to the student.
    this.child.stderr.on("data", () => this.fail("codec-exit"));
    this.child.stdin.on("error", () => {}); // close supplies the actual signal/exit outcome.
    this.child.once("error", () => this.fail("codec-spawn"));
    this.child.once("exit", () => {
      this.exited = true;
    });
    this.child.once("close", (code, signal) => {
      this.closed = true;
      clearTimeout(this.lifetime);
      if (this.pending || code !== 0 || signal)
        this.fail(
          signal ? "codec-signal" : code !== 0 ? "codec-exit" : "codec-output",
          signal ?? undefined,
        );
      this.resolveDone();
    });
  }

  get live() {
    return !this.closed && !this.exited && !this.failure;
  }
  get frames() {
    return this.framesRead;
  }

  private fail(stage: CaptureVideoStage, signal?: NodeJS.Signals) {
    this.failure ??= new CaptureVideoUnavailable(signal, stage);
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(this.failure);
    }
    clearTimeout(this.lifetime);
    // Detached process groups are owned from spawn through close. Never signal
    // a remembered PID after its exit, when the kernel may reuse its identity.
    if (!this.exited && !this.closed && this.pid) {
      try {
        process.kill(-this.pid, "SIGKILL");
      } catch {}
    }
  }

  close(stage: CaptureVideoStage = "closed") {
    if (!this.closed) this.fail(stage);
    return this.done;
  }

  private output(part: Buffer) {
    if (this.failure) return;
    const pending = this.pending;
    if (!pending || !part.length) {
      this.fail("codec-output");
      return;
    }
    const boundary = pending.previousByte === 0xff && part[0] === 0xd9;
    const marker = part.indexOf(Buffer.from([0xff, 0xd9]));
    const end = boundary ? 1 : marker < 0 ? -1 : marker + 2;
    pending.bytes += part.length;
    if (pending.bytes > 1_490_000 || (end !== -1 && end !== part.length)) {
      this.fail("codec-output");
      return;
    }
    pending.parts.push(part);
    pending.previousByte = part[part.length - 1];
    if (end !== -1) {
      const jpeg = Buffer.concat(pending.parts, pending.bytes);
      if (jpeg.length < 32 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
        this.fail("codec-output");
        return;
      }
      pending.jpeg = jpeg;
      this.complete();
    }
  }

  private complete() {
    const pending = this.pending;
    if (!pending?.written || !pending.jpeg || this.failure) return;
    this.pending = undefined;
    clearTimeout(pending.timer);
    this.framesRead = pending.index + 1;
    pending.resolve(pending.jpeg);
    if (this.framesRead === 12) this.child.stdin.end();
  }

  frame(ivf: Buffer, index: number): Promise<Buffer> {
    if (
      !this.live ||
      this.pending ||
      index < 0 ||
      index >= 12 ||
      (!this.initialized ? index !== this.bootstrap : index !== this.framesRead)
    )
      return Promise.reject(
        this.failure ??
          new CaptureVideoUnavailable(undefined, "prediction-chain"),
      );
    let payload: Buffer;
    try {
      const packets: Buffer[] = [];
      let offset = 32;
      for (let number = 0; number <= index; number++) {
        if (offset + 12 > ivf.length)
          throw new Error("invalid internal packet frame");
        const size = ivf.readUInt32LE(offset);
        if (!size || offset + 12 + size > ivf.length)
          throw new Error("invalid internal packet size");
        const packet = ivf.subarray(offset + 12, offset + 12 + size);
        if (
          (!this.initialized || number === index) &&
          displayedFrames(packet) !== 1
        )
          throw new Error("one displayed image per capture required");
        packets.push(ivf.subarray(offset, offset + 12 + size));
        offset += 12 + size;
      }
      if (offset !== ivf.length)
        throw new Error("invalid internal packet tail");
      if (!this.initialized) {
        const header = Buffer.from(ivf.subarray(0, 32));
        header.writeUInt32LE(12, 24);
        payload = Buffer.concat([header, ...packets]);
      } else payload = packets[index];
    } catch {
      this.fail("codec-exit");
      return Promise.reject(this.failure);
    }
    this.initialized = true;
    return new Promise<Buffer>((resolve, reject) => {
      const pending: PendingFrame = {
        index,
        parts: [],
        bytes: 0,
        previousByte: -1,
        written: false,
        timer: setTimeout(() => this.fail("codec-timeout"), 15_000),
        resolve,
        reject,
      };
      pending.timer.unref();
      this.pending = pending;
      this.child.stdin.write(payload, (error) => {
        if (this.pending !== pending) return;
        if (error)
          return; // Wait for close (or the original frame deadline).
        else {
          pending.written = true;
          this.complete();
        }
      });
    });
  }
}
