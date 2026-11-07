import { liveMonitoring } from "../fixtures/live-monitoring.js";
import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { hash } from "../../apps/server/src/db.js";
import {
  captureDigest,
  readCaptureReceipt,
} from "../../apps/server/src/capture-upload-receipt.js";
import {
  CAPTURE_UPLOAD_TYPE,
  encodeCaptureUpload,
  type CaptureUploadMetadata,
} from "../../packages/protocol/capture-upload.js";

const clock = vi.hoisted(() => ({ now: 10_000 }));
vi.mock("../../apps/server/src/monitoring-clock.js", () => ({
  monitoringBootTimeMS: () => clock.now,
}));
afterEach(() => {
  clock.now = 10_000;
  vi.restoreAllMocks();
});
const sampleCache = new Map<string, Buffer[]>();
function samples(size = "128x72") {
  if (sampleCache.has(size)) return sampleCache.get(size)!;
  const ivf = execFileSync(
    "/usr/bin/ffmpeg",
    [
      "-v",
      "error",
      "-threads",
      "1",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=${size}:rate=1/5`,
      "-frames:v",
      "3",
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
    { timeout: 10_000 },
  );
  const packets: Buffer[] = [];
  let offset = 32;
  while (offset < ivf.length) {
    const length = ivf.readUInt32LE(offset);
    packets.push(ivf.subarray(offset + 12, offset + 12 + length));
    offset += 12 + length;
  }
  expect(packets).toHaveLength(3);
  sampleCache.set(size, packets);
  return packets;
}
async function fixture() {
  // Own the complete SSH/authentication/binding transaction. A seeded attempt
  // row alone is deliberately insufficient for authenticated capture.
  const base = await liveMonitoring({ webcam: false });
  const { app, store, id, headers } = base;
  const dir = store.dir,
    url = `/api/student/attempts/${id}`,
    chain = randomUUID();
  const admin = store.session("admin", "teacher", null);
  const initialFrames = (
    store.db.prepare("SELECT count(*) n FROM frames").get() as any
  ).n;
  return {
    ...base,
    dir,
    url,
    chain,
    admin,
    initialFrames,
    async metadata(index: number): Promise<CaptureUploadMetadata> {
      const reply = await app.inject({
        method: "POST",
        url: url + "/capture-challenges",
        headers,
        payload: { source: "screen" },
      });
      expect(reply.statusCode, reply.body).toBe(200);
      const ticket = reply.json();
      expect(ticket.upload.video).toBe("vp9-v1");
      return {
        version: 1,
        encoding: "vp9",
        source: "screen",
        seq: ticket.after_sequence + 1,
        captured: Date.now(),
        monotonic: 1,
        challenge: ticket.challenge,
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
          previous: index ? captureDigest(samples()[index - 1]) : null,
          key: index === 0,
          width: 128,
          height: 72,
        },
      };
    },
    post(metadata: CaptureUploadMetadata, bytes: Buffer) {
      return app.inject({
        method: "POST",
        url: url + "/frames/binary",
        headers: { ...headers, "content-type": CAPTURE_UPLOAD_TYPE },
        payload: Buffer.from(encodeCaptureUpload(metadata, bytes)),
      });
    },
  };
}

it("authenticated VP9 samples preserve canonical images, exact retry age, review media and protected clocks", async () => {
  const f = await fixture(),
    before = f.store.attempt(f.id);
  try {
    for (let index = 0; index < 3; index++) {
      const metadata = await f.metadata(index),
        packet = samples()[index],
        reply = await f.post(metadata, packet);
      expect(reply.statusCode, reply.body).toBe(200);
      const result = reply.json();
      const bytes = readFileSync(
        `${f.dir}/monitoring/${f.id}/${result.id}.jpg`,
      );
      expect(hash(bytes)).toBe(result.hash);
      expect(readCaptureReceipt(bytes)).toMatchObject({
        encoding: "vp9-upload-v1",
        packet_sha256: hash(packet),
      });
      expect(await sharp(bytes).metadata()).toMatchObject({
        format: "jpeg",
        width: 128,
        height: 72,
      });
      clock.now += 1000;
      const retry = await f.post(metadata, packet);
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json().id).toBe(result.id);
      expect(retry.json().monitoring.age_ms).toBe(1000);
      const read = await f.app.inject({
        url: `/api/admin/media/${result.id}`,
        headers: { cookie: `session=${f.admin.token}` },
      });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.rawPayload).toEqual(bytes);
    }
    expect(f.store.attempt(f.id)).toEqual(before);
    expect(f.monitoring.uploadVideo.active).toBe(0);
    // A client cannot pass off the server's decoded-image receipt as its own JPEG.
    const row = f.store.db
      .prepare(
        "SELECT id FROM frames WHERE attempt=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(f.id) as any;
    const metadata = {
      ...(await f.metadata(0)),
      encoding: "jpeg" as const,
      video: undefined,
    };
    const spoof = await f.post(
      metadata,
      readFileSync(`${f.dir}/monitoring/${f.id}/${row.id}.jpg`),
    );
    expect(spoof.statusCode).toBe(400);
    expect(f.store.db.prepare("SELECT count(*) n FROM frames").get()).toEqual({
      n: f.initialFrames + 3,
    });
  } finally {
    await f.close();
  }
});

it("thirty-two full-size decoder streams stay bounded while authenticated SSH, public JPEG capture and health remain responsive", async () => {
  const f = await fixture(),
    decoder = f.monitoring.uploadVideo as any,
    realDecode = decoder.decode.bind(decoder);
  let release!: () => void,
    arrived = 0,
    peak = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const control = vi
    .spyOn(decoder, "decode")
    .mockImplementation(async (...args: unknown[]) => {
      const task = realDecode(...args);
      peak = Math.max(peak, decoder.active);
      const jpeg = await task;
      if (++arrived <= 4) await gate;
      return jpeg;
    });
  let pending: Promise<unknown> | undefined;
  try {
    const work: {
      metadata: CaptureUploadMetadata;
      scope: string;
      bytes: Buffer;
    }[] = [];
    for (let student = 0; student < 16; student++) {
      for (const source of ["screen", "webcam"] as const) {
        const metadata: CaptureUploadMetadata = {
          version: 1,
          encoding: "vp9",
          source,
          seq: 1,
          captured: Date.now(),
          monotonic: 1,
          challenge: randomUUID(),
          readiness: {
            fullscreen: true,
            visible: true,
            focus: true,
            keyboard: true,
            screen: true,
            webcam: true,
          },
          video: {
            chain: randomUUID(),
            previous: null,
            key: true,
            width: source === "screen" ? 1280 : 320,
            height: source === "screen" ? 720 : 240,
          },
        };
        work.push({
          metadata,
          scope: `capacity-${student}-${source}`,
          bytes: samples(source === "screen" ? "1280x720" : "320x240")[0],
        });
      }
    }
    const started = performance.now();
    let decoded = 0;
    pending = Promise.all(
      work.map((entry) =>
        decoder.accept(
          entry.scope,
          entry.metadata,
          entry.bytes,
          async (jpeg: Buffer) => {
            expect(await sharp(jpeg).metadata()).toMatchObject({
              width: entry.metadata.video!.width,
              height: entry.metadata.video!.height,
            });
            decoded++;
          },
        ),
      ),
    );
    void pending.catch(() => {}); // Collected below; do not hide a refusal behind the gate wait.
    await vi.waitFor(() => expect(arrived).toBe(4), {
      timeout: 5000,
      interval: 10,
    });
    const healthStart = performance.now();
    const health = await f.app.inject({ url: "/health/live" });
    expect(health.statusCode).toBe(200);
    const jpegMeta = {
      ...(await f.metadata(0)),
      encoding: "jpeg" as const,
      video: undefined,
    };
    const jpeg = await sharp({
      create: { width: 128, height: 72, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const jpegReply = await f.post(jpegMeta, jpeg);
    expect(jpegReply.statusCode, jpegReply.body).toBe(200);
    expect(performance.now() - healthStart).toBeLessThan(1500);
    release();
    await pending;
    expect(decoded).toBe(32);
    expect(peak).toBe(4);
    expect(decoder.active).toBe(0);
    expect(f.store.db.prepare("SELECT count(*) n FROM frames").get()).toEqual({
      n: f.initialFrames + 1,
    });
    expect(
      f.store.db.prepare("SELECT count(*) n FROM incidents").get(),
    ).toEqual({ n: 0 });
    console.log(
      JSON.stringify({
        students: 16,
        simultaneous_sources: 32,
        decoder_peak: peak,
        elapsed_ms: performance.now() - started,
      }),
    );
  } finally {
    release();
    await pending;
    control.mockRestore();
    await f.close();
  }
}, 20000);

it.each([
  "missing",
  "wrong-previous",
  "replaced-generation",
  "expired",
  "invalid-codec",
  "dimensions",
  "decoder-killed",
])(
  "video %s refusal starts no clock or work and a fresh JPEG remains usable",
  async (reason) => {
    const f = await fixture(),
      before = f.store.attempt(f.id);
    try {
      const metadata = await f.metadata(
        reason === "missing" || reason === "wrong-previous" ? 1 : 0,
      );
      if (reason === "wrong-previous")
        metadata.video!.previous = "f".repeat(64);
      if (reason === "dimensions") metadata.video!.width = 127;
      if (
        reason === "replaced-generation" ||
        reason === "expired" ||
        reason === "decoder-killed"
      ) {
        const decoder = f.monitoring.uploadVideo as any,
          original = decoder.decode.bind(decoder);
        vi.spyOn(decoder, "decode").mockImplementation(
          async (...args: unknown[]) => {
            const task = original(...args);
            if (reason === "decoder-killed") {
              expect(decoder.pids).toHaveLength(1);
              process.kill(-decoder.pids[0], "SIGKILL");
              await expect(task).rejects.toMatchObject({ signal: "SIGKILL" });
              return task;
            }
            const jpeg = await task;
            if (reason === "expired") clock.now += 60_001;
            else
              f.store.db
                .prepare(
                  "UPDATE attempts SET generation=generation+1 WHERE id=?",
                )
                .run(f.id);
            return jpeg;
          },
        );
      }
      const refused = await f.post(
        metadata,
        reason === "invalid-codec"
          ? Buffer.alloc(64, 17)
          : samples()[metadata.video!.key ? 0 : 1],
      );
      expect(refused.statusCode, refused.body).toBeGreaterThanOrEqual(400);
      expect(refused.statusCode).toBeLessThan(500);
      expect(f.store.db.prepare("SELECT count(*) n FROM frames").get()).toEqual(
        { n: f.initialFrames },
      );
      const after = f.store.attempt(f.id)!;
      expect(after.start).toBe(before!.start);
      expect(after.deadline).toBe(before!.deadline);
      vi.restoreAllMocks();
      const fresh = {
        ...(await f.metadata(0)),
        encoding: "jpeg" as const,
        video: undefined,
      };
      const jpeg = await sharp({
        create: { width: 128, height: 72, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer();
      const retry = await f.post(fresh, jpeg);
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json().monitoring.complete).toBe(true);
      expect(f.monitoring.uploadVideo.active).toBe(0);
    } finally {
      await f.close();
    }
  },
);
