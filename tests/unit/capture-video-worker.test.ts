import { afterEach, expect, it, vi } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CaptureVideoWorker } from "../../apps/server/src/capture-video-codec.js";
import { CaptureVideoIngress } from "../../apps/server/src/capture-video-ingress.js";
import {
  captureDigest,
  readCaptureReceipt,
} from "../../apps/server/src/capture-upload-receipt.js";
import type { CaptureUploadMetadata } from "../../packages/protocol/capture-upload.js";

const authored = execFileSync(
  "/usr/bin/ffmpeg",
  [
    "-v",
    "error",
    "-threads",
    "1",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=128x72:rate=1/5",
    "-frames:v",
    "12",
    "-c:v",
    "libvpx-vp9",
    "-deadline",
    "realtime",
    "-cpu-used",
    "6",
    "-b:v",
    "20000",
    "-g",
    "12",
    "-threads",
    "1",
    "-f",
    "ivf",
    "pipe:1",
  ],
  { timeout: 10000 },
);
const packets: Buffer[] = [],
  prefixes: Buffer[] = [];
for (let offset = 32; offset < authored.length; ) {
  const size = authored.readUInt32LE(offset);
  packets.push(authored.subarray(offset + 12, offset + 12 + size));
  offset += 12 + size;
  const prefix = Buffer.from(authored.subarray(0, offset));
  prefix.writeUInt32LE(packets.length, 24);
  prefixes.push(prefix);
}
function metadata(index = 0, chain = randomUUID()): CaptureUploadMetadata {
  return {
    version: 1,
    encoding: "vp9",
    source: "screen",
    seq: index + 1,
    captured: Date.now(),
    monotonic: 1,
    challenge: randomUUID(),
    readiness: {
      fullscreen: true,
      visible: true,
      focus: true,
      keyboard: true,
      screen: true,
      webcam: false,
    },
    video: {
      chain,
      previous: index ? captureDigest(packets[index - 1]) : null,
      key: index === 0,
      width: 128,
      height: 72,
    },
  };
}
function gone(pid: number | undefined) {
  expect(pid).toBeDefined();
  expect(() => process.kill(pid!, 0)).toThrowError(
    expect.objectContaining({ code: "ESRCH" }),
  );
}
afterEach(() => vi.useRealTimers());

it("streaming and reconstructed prefixes match independent fresh decoding of every authored frame", async () => {
  const worker = new CaptureVideoWorker("synthetic-prefix", 0);
  try {
    expect(packets).toHaveLength(12);
    for (let index = 0; index < packets.length; index++) {
      const actual = await worker.frame(prefixes[index], index);
      const expected = execFileSync(
        "/usr/bin/ffmpeg",
        [
          "-v",
          "error",
          "-threads",
          "1",
          "-f",
          "ivf",
          "-i",
          "pipe:0",
          "-an",
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
        { input: prefixes[index], timeout: 10000 },
      );
      expect(actual.equals(expected), "decoded frame " + index).toBe(true);
      if (index === 6) {
        const reconstructed = new CaptureVideoWorker(
          "synthetic-reconstructed",
          index,
        );
        try {
          expect(await reconstructed.frame(prefixes[index], index)).toEqual(
            expected,
          );
        } finally {
          await reconstructed.close();
          gone(reconstructed.pid);
        }
      }
    }
    await worker.done;
    expect(worker.failure).toBeUndefined();
    gone(worker.pid);
  } finally {
    await worker.close();
  }
});

it("multiple displayed images in a single upload refuse before publication and a new keyframe remains usable", async () => {
  const ingress = new CaptureVideoIngress();
  const marker = 0xc9,
    index = Buffer.alloc(6);
  index[0] = index[5] = marker;
  index.writeUInt16LE(packets[0].length, 1);
  index.writeUInt16LE(packets[1].length, 3);
  const malformed = Buffer.concat([packets[0], packets[1], index]);
  const publish = vi.fn(async (jpeg: Buffer) => jpeg);
  try {
    await expect(
      ingress.accept("synthetic", metadata(), malformed, publish),
    ).rejects.toMatchObject({ stage: "codec-exit" });
    expect(publish).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(ingress.pids).toEqual([]));
    expect(
      await ingress.accept("synthetic", metadata(), packets[0], publish),
    ).toBeInstanceOf(Buffer);
    expect(publish).toHaveBeenCalledTimes(1);
  } finally {
    await ingress.close();
  }
});

it.each(["timeout", "shutdown"])(
  "a stopped decoder has bounded %s and is reaped without another packet",
  async (mode) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const worker = new CaptureVideoWorker("synthetic-stopped", 0);
    process.kill(-worker.pid!, "SIGSTOP");
    const result = worker.frame(prefixes[0], 0).then(
      () => null,
      (error) => error,
    );
    try {
      if (mode === "timeout") await vi.advanceTimersByTimeAsync(15001);
      else await worker.close();
      expect(await result).toMatchObject({
        stage: mode === "timeout" ? "codec-timeout" : "closed",
      });
      await worker.done;
      gone(worker.pid);
    } finally {
      await worker.close();
    }
  },
);

it("expiry releases a warm process and reconstructs only the verified prefix on the next upload", async () => {
  const ingress = new CaptureVideoIngress(),
    chain = randomUUID();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await ingress.accept(
      "synthetic",
      metadata(0, chain),
      packets[0],
      async () => {},
    );
    const pid = ingress.pids[0];
    await vi.advanceTimersByTimeAsync(120001);
    vi.useRealTimers();
    await vi.waitFor(() => expect(ingress.pids).toEqual([]));
    gone(pid);
    const reply = await ingress.accept(
      "synthetic",
      metadata(1, chain),
      packets[1],
      async (jpeg) => jpeg,
    );
    expect(readCaptureReceipt(reply)).toMatchObject({
      packet_sha256: captureDigest(packets[1]),
      prediction_sha256: captureDigest(prefixes[1]),
    });
    expect(ingress.pids).toHaveLength(1);
    expect(ingress.pids[0]).not.toBe(pid);
  } finally {
    vi.useRealTimers();
    await ingress.close();
  }
});

it("retention overflow reconstructs a discarded stream instead of refusing or increasing the warm-process bound", async () => {
  const ingress = new CaptureVideoIngress(),
    chains = Array.from({ length: 24 }, () => randomUUID());
  try {
    for (let index = 0; index < chains.length; index++) {
      const jpeg = await ingress.accept(
        "synthetic-" + index,
        metadata(0, chains[index]),
        packets[0],
        async (jpeg) => jpeg,
      );
      expect(readCaptureReceipt(jpeg)?.packet_sha256).toBe(
        captureDigest(packets[0]),
      );
      expect(ingress.pids.length).toBeLessThanOrEqual(8);
    }
    const retained = [...ingress.pids];
    const result = await ingress.accept(
      "synthetic-23",
      metadata(1, chains[23]),
      packets[1],
      async (jpeg) => jpeg,
    );
    expect(readCaptureReceipt(result)).toMatchObject({
      prediction_sha256: captureDigest(prefixes[1]),
    });
    expect(ingress.pids).toEqual(retained);
  } finally {
    await ingress.close();
  }
  expect(ingress.pids).toEqual([]);
  await expect(
    ingress.accept("after-close", metadata(), packets[0], async () => {}),
  ).rejects.toMatchObject({ stage: "closed" });
});

it("maximum square captures reduce retention before exceeding the resolution-weighted worker budget", async () => {
  const full = execFileSync(
    "/usr/bin/ffmpeg",
    [
      "-v",
      "error",
      "-threads",
      "1",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x1280:rate=1/5",
      "-frames:v",
      "1",
      "-c:v",
      "libvpx-vp9",
      "-deadline",
      "realtime",
      "-cpu-used",
      "6",
      "-b:v",
      "20000",
      "-threads",
      "1",
      "-f",
      "ivf",
      "pipe:1",
    ],
    { timeout: 10000 },
  );
  const packet = full.subarray(44, 44 + full.readUInt32LE(32));
  const ingress = new CaptureVideoIngress();
  try {
    for (let index = 0; index < 18; index++) {
      const meta = metadata();
      meta.video!.width = meta.video!.height = 1280;
      await ingress.accept("large-" + index, meta, packet, async (jpeg) => {
        expect(readCaptureReceipt(jpeg)?.packet_sha256).toBe(
          captureDigest(packet),
        );
      });
      expect(ingress.pids.length).toBeLessThanOrEqual(6);
    }
    expect(ingress.pids).toHaveLength(6);
  } finally {
    await ingress.close();
  }
  expect(ingress.pids).toEqual([]);
});

it("a killed coordinator leaves no warm decoder process behind", async () => {
  const entry = new URL(
    "../../apps/server/src/capture-video-codec.ts",
    import.meta.url,
  ).href;
  const source = `import {CaptureVideoWorker} from ${JSON.stringify(entry)};
    const worker=new CaptureVideoWorker("synthetic-owner-death",0);
    await worker.frame(Buffer.from(${JSON.stringify(prefixes[0].toString("base64"))},"base64"),0);
    process.send({pid:worker.pid});`;
  const owner = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", source],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  let codec: number | undefined, identity: string | undefined;
  try {
    codec = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("warm decoder readiness missing")),
        3000,
      );
      owner.once("message", (message: any) => {
        clearTimeout(timer);
        resolve(message.pid);
      });
      owner.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      owner.once("exit", () => {
        clearTimeout(timer);
        reject(Error("owner exited before readiness"));
      });
    });
    identity = readFileSync(`/proc/${codec}/stat`, "utf8")
      .split(") ")[1]
      .split(" ")[19];
    const exited = once(owner, "exit");
    owner.kill("SIGKILL");
    expect(await exited).toEqual([null, "SIGKILL"]);
    await vi.waitFor(() => gone(codec), { timeout: 3000 });
  } finally {
    if (owner.exitCode === null && owner.signalCode === null) {
      const exited = once(owner, "exit");
      owner.kill("SIGKILL");
      await exited;
    }
    // Clean only this exact owned codec if its asserted exit failed.
    if (codec && identity) {
      try {
        if (
          readFileSync(`/proc/${codec}/stat`, "utf8")
            .split(") ")[1]
            .split(" ")[19] === identity
        )
          process.kill(-codec, "SIGKILL");
      } catch (error: any) {
        if (!["ENOENT", "ESRCH"].includes(error.code)) throw error;
      }
    }
  }
});
