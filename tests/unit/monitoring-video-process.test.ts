import { expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  rmSync,
  existsSync,
  symlinkSync,
  linkSync,
  readlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { Store } from "../../apps/server/src/db.js";
import {
  MonitoringVideoProcess,
  type VideoRunInput,
} from "../../apps/server/src/monitoring-video-process.js";
const hash = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
async function fixture(
  attempt: string = randomUUID(),
  width = 320,
  height = 240,
  count = 3,
) {
  const store = new Store(
    mkdtempSync(join(tmpdir(), "monitoring-video-test-")),
  );
  store.db.exec("INSERT INTO exams VALUES('synthetic-video','{}')");
  const directory = join(store.dir, "monitoring", attempt);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,ended,original_deadline) VALUES(?, 'synthetic-video','synthetic',10000,'COMPLETED','{}',1000,2000,2000,2000)",
    )
    .run(attempt);
  const frames: VideoRunInput["frames"] = [];
  for (let index = 0; index < count; index++) {
    const svg = Buffer.from(
      '<svg width="' +
        width +
        '" height="' +
        height +
        '"><rect width="100%" height="100%" fill="#345678"/><rect x="' +
        Math.max(0, width - 12) +
        '" width="12" height="100%" fill="#00ff00"/><rect y="' +
        Math.max(0, height - 12) +
        '" width="100%" height="12" fill="#0044ff"/><text x="8" y="26" fill="white">Synthetic frame ' +
        index +
        "</text></svg>",
    );
    const bytes = await sharp(svg).jpeg({ quality: 75 }).toBuffer(),
      id = randomUUID();
    writeFileSync(join(directory, id + ".jpg"), bytes, { mode: 0o600 });
    frames.push({
      id,
      hash: hash(bytes),
      captured: 1000 + index * 5000,
      width,
      height,
    });
  }
  const job = () => {
    const segment = randomUUID(),
      work = join(directory, ".video-work-" + segment);
    mkdirSync(work, { mode: 0o700 });
    return { attempt, segment, source: "screen" as const, work, frames };
  };
  return {
    store,
    attempt,
    directory,
    frames,
    job,
    close() {
      store.close();
      rmSync(store.dir, { recursive: true, force: true });
    },
  };
}

it.skipIf(process.platform !== "linux")(
  "encodes a verified short VP9 segment and derives each original/thumbnail through the isolated reader without changing originals or authority",
  async () => {
    const f = await fixture(),
      worker = new MonitoringVideoProcess(f.store);
    const before = f.store.db.prepare("SELECT * FROM attempts").all(),
      originals = f.frames.map((frame) =>
        readFileSync(join(f.directory, frame.id + ".jpg")),
      );
    try {
      const input = f.job(),
        result = await worker.run(input);
      expect(result).toMatchObject({
        version: 1,
        attempt: f.attempt,
        source: "screen",
        width: 320,
        height: 240,
        duration_ms: 15000,
      });
      expect(
        result.frames.map((frame) => ({
          id: frame.id,
          original_hash: frame.original_hash,
          captured: frame.captured,
          index: frame.index,
          presentation_ms: frame.presentation_ms,
        })),
      ).toEqual(
        f.frames.map((frame, index) => ({
          id: frame.id,
          original_hash: frame.hash,
          captured: frame.captured,
          index,
          presentation_ms: index * 5000,
        })),
      );
      expect(hash(readFileSync(join(input.work, result.file)))).toBe(
        result.sha256,
      );
      expect(
        JSON.parse(readFileSync(join(input.work, "manifest.json"), "utf8")),
      ).toEqual(result);
      renameSync(join(input.work, result.file), join(f.directory, result.file));
      for (const frame of result.frames) {
        const request = {
          attempt: f.attempt,
          segment: result.segment,
          sha256: result.sha256,
          index: frame.index,
          decoded_sha256: frame.decoded_sha256,
          width: result.width,
          height: result.height,
        };
        const originalStarted = performance.now();
        const image = await worker.frame(request);
        const originalMs = performance.now() - originalStarted;
        const thumbnailStarted = performance.now();
        const thumbnail = await worker.frame({ ...request, thumbnail: true });
        if (frame.index === 0)
          console.log(
            JSON.stringify({
              video_review_latency_ms: {
                original: originalMs,
                thumbnail: performance.now() - thumbnailStarted,
              },
            }),
          );
        expect(await sharp(image).metadata()).toMatchObject({
          format: "jpeg",
          width: 320,
          height: 240,
        });
        expect(await sharp(thumbnail).metadata()).toMatchObject({
          format: "jpeg",
          width: 256,
          height: 192,
        });
      }
      expect(f.store.db.prepare("SELECT * FROM attempts").all()).toEqual(
        before,
      );
      f.frames.forEach((frame, index) =>
        expect(readFileSync(join(f.directory, frame.id + ".jpg"))).toEqual(
          originals[index],
        ),
      );
    } finally {
      await worker.close();
      f.close();
    }
  },
  30000,
);

it.skipIf(process.platform !== "linux")(
  "pads odd source dimensions without cropping the selected surface and bounds portrait camera output",
  async () => {
    for (const [width, height, source, expected] of [
      [333, 201, "screen", [334, 202]],
      [513, 641, "webcam", [256, 320]],
    ] as const) {
      const f = await fixture(randomUUID(), width, height, 1),
        worker = new MonitoringVideoProcess(f.store);
      try {
        const input = { ...f.job(), source },
          result = await worker.run(input);
        expect([result.width, result.height]).toEqual(expected);
        renameSync(
          join(input.work, result.file),
          join(f.directory, result.file),
        );
        const image = await worker.frame({
          attempt: f.attempt,
          segment: result.segment,
          sha256: result.sha256,
          index: 0,
          decoded_sha256: result.frames[0].decoded_sha256,
          width: result.width,
          height: result.height,
        });
        expect(await sharp(image).metadata()).toMatchObject({
          width: expected[0],
          height: expected[1],
        });
        if (source === "screen") {
          const { data, info } = await sharp(image)
            .raw()
            .toBuffer({ resolveWithObject: true });
          const pixel = (x: number, y: number) =>
            Array.from(
              data.subarray(
                (y * info.width + x) * 3,
                (y * info.width + x) * 3 + 3,
              ),
            );
          const right = pixel(width - 6, 70),
            bottom = pixel(70, height - 6);
          expect(right[1]).toBeGreaterThan(right[0] + 50);
          expect(bottom[2]).toBeGreaterThan(bottom[0] + 50);
        }
      } finally {
        await worker.close();
        f.close();
      }
    }
  },
  30000,
);

it.skipIf(process.platform !== "linux")(
  "refuses active/deleted attempts and malformed or redirected requests before granting any codec authority",
  async () => {
    const f = await fixture(),
      worker = new MonitoringVideoProcess(f.store);
    try {
      f.store.db
        .prepare("UPDATE attempts SET state='ACTIVE' WHERE id=?")
        .run(f.attempt);
      await expect(worker.run(f.job())).rejects.toMatchObject({
        code: "requires-completed-retained-attempt",
      });
      expect(worker.pids).toEqual([]);
      f.store.db
        .prepare("UPDATE attempts SET state='COMPLETED' WHERE id=?")
        .run(f.attempt);
      await expect(
        worker.run({ ...f.job(), work: join(f.store.dir, "submissions") }),
      ).rejects.toMatchObject({ code: "unsafe-target" });
      await expect(
        worker.run({
          ...f.job(),
          frames: Array.from({ length: 13 }, () => f.frames[0]),
        }),
      ).rejects.toMatchObject({ code: "invalid-request" });
      f.store.db
        .prepare("INSERT INTO tombstones VALUES(?,?)")
        .run(f.attempt, Date.now());
      await expect(worker.run(f.job())).rejects.toMatchObject({
        code: "requires-completed-retained-attempt",
      });
    } finally {
      await worker.close();
      f.close();
    }
  },
);

it.skipIf(process.platform !== "linux")(
  "refuses source digest corruption and symlink/hardlink inputs, leaves originals intact, and retries using a fresh private work directory",
  async () => {
    const f = await fixture(),
      worker = new MonitoringVideoProcess(f.store);
    const original = readFileSync(join(f.directory, f.frames[0].id + ".jpg"));
    try {
      await expect(
        worker.run({
          ...f.job(),
          frames: f.frames.map((frame, index) =>
            index ? frame : { ...frame, hash: "0".repeat(64) },
          ),
        }),
      ).rejects.toMatchObject({ code: "source-digest" });
      const path = join(f.directory, f.frames[0].id + ".jpg"),
        saved = path + ".saved";
      renameSync(path, saved);
      symlinkSync(saved, path);
      await expect(worker.run(f.job())).rejects.toMatchObject({
        code: "storage",
      });
      rmSync(path);
      linkSync(saved, path);
      await expect(worker.run(f.job())).rejects.toMatchObject({
        code: "unsafe-target",
      });
      rmSync(path);
      renameSync(saved, path);
      expect(readFileSync(path)).toEqual(original);
      await expect(worker.run(f.job())).resolves.toMatchObject({
        frames: expect.any(Array),
      });
    } finally {
      await worker.close();
      f.close();
    }
  },
  30000,
);

it.skipIf(process.platform !== "linux")(
  "refuses altered segment bytes and a wrong decoded-frame digest without substituting an original or an adjacent frame",
  async () => {
    const f = await fixture(),
      worker = new MonitoringVideoProcess(f.store);
    try {
      const input = f.job(),
        result = await worker.run(input);
      renameSync(join(input.work, result.file), join(f.directory, result.file));
      const request = {
        attempt: f.attempt,
        segment: result.segment,
        sha256: result.sha256,
        index: 1,
        decoded_sha256: result.frames[1].decoded_sha256,
        width: result.width,
        height: result.height,
      };
      await expect(
        worker.frame({ ...request, decoded_sha256: "0".repeat(64) }),
      ).rejects.toMatchObject({ code: "digest" });
      const path = join(f.directory, result.file),
        original = readFileSync(path);
      writeFileSync(
        path,
        Buffer.concat([original, Buffer.from("synthetic-corruption")]),
      );
      await expect(worker.frame(request)).rejects.toMatchObject({
        code: "digest",
      });
      f.frames.forEach((frame) =>
        expect(existsSync(join(f.directory, frame.id + ".jpg"))).toBe(true),
      );
    } finally {
      await worker.close();
      f.close();
    }
  },
  30000,
);

it.skipIf(process.platform !== "linux")(
  "contains exact worker SIGKILL, panic, timeout and forged success; keeps the coordinator responsive and permits a fresh healthy retry",
  async () => {
    let pulses = 0;
    const timer = setInterval(() => pulses++, 10);
    try {
      for (const attempt of ["kill", "panic", "hang", "forged"]) {
        const f = await fixture(attempt),
          worker = new MonitoringVideoProcess(f.store, {
            entry: new URL(
              "../fixtures/faulting-video-worker.ts",
              import.meta.url,
            ),
            timeoutMs: attempt === "hang" ? 600 : 5000,
          }),
          healthy = new MonitoringVideoProcess(f.store);
        try {
          const error = await worker.run(f.job()).catch((error) => error);
          expect(error.code).toBe(
            attempt === "hang"
              ? "timeout"
              : attempt === "forged"
                ? "storage"
                : "worker-exit",
          );
          if (attempt === "kill" || attempt === "hang")
            expect(error.signal).toBe("SIGKILL");
          expect(error.message).not.toMatch(/PRIVATE|\.jpg|\/tmp/);
          expect(worker.pids).toEqual([]);
          await expect(healthy.run(f.job())).resolves.toMatchObject({
            attempt,
          });
        } finally {
          await worker.close();
          await healthy.close();
          f.close();
        }
      }
      expect(pulses).toBeGreaterThan(10);
    } finally {
      clearInterval(timer);
    }
  },
  30000,
);

it.skipIf(process.platform !== "linux")(
  "enforces one encoder and two independent review slots across coordinators, and releases each exact worker lock at shutdown",
  async () => {
    const f = await fixture("hang"),
      options = {
        entry: new URL("../fixtures/faulting-video-worker.ts", import.meta.url),
        timeoutMs: 10000,
      };
    const encoder = new MonitoringVideoProcess(f.store, options),
      readerA = new MonitoringVideoProcess(f.store, options),
      readerB = new MonitoringVideoProcess(f.store, options),
      other = new MonitoringVideoProcess(f.store, options);
    const waits: Promise<unknown>[] = [];
    const ready = async (worker: MonitoringVideoProcess) => {
      const deadline = Date.now() + 3000;
      while (true) {
        if (
          worker.pids.some((pid) => {
            try {
              return readlinkSync("/proc/" + pid + "/exe") === process.execPath;
            } catch {
              return false;
            }
          })
        )
          return;
        if (Date.now() > deadline)
          throw Error("Owned fault worker did not acquire its lock and exec");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    try {
      waits.push(encoder.run(f.job()).catch((error) => error));
      await ready(encoder);
      await expect(other.run(f.job())).rejects.toMatchObject({
        code: "capacity",
      });
      const input = {
        attempt: f.attempt,
        segment: randomUUID(),
        sha256: "0".repeat(64),
        index: 0,
        decoded_sha256: "0".repeat(64),
        width: 320,
        height: 240,
      };
      waits.push(readerA.frame(input).catch((error) => error));
      await ready(readerA);
      waits.push(readerB.frame(input).catch((error) => error));
      await ready(readerB);
      await expect(other.frame(input)).rejects.toMatchObject({
        code: "capacity",
      });
      await encoder.close();
      expect(encoder.pids).toEqual([]);
      expect(readerA.pids.length).toBe(1);
      expect(readerB.pids.length).toBe(1);
      waits.push(other.run(f.job()).catch((error) => error));
      await ready(other);
    } finally {
      await Promise.all([
        encoder.close(),
        readerA.close(),
        readerB.close(),
        other.close(),
      ]);
      for (const result of await Promise.all(waits))
        expect(result).toMatchObject({
          code: "worker-exit",
          signal: "SIGKILL",
        });
      f.close();
    }
  },
  15000,
);

it.skipIf(process.platform !== "linux")(
  "refuses a correct decoded digest paired with swapped geometry rather than reshaping the source",
  async () => {
    const f = await fixture(),
      worker = new MonitoringVideoProcess(f.store);
    try {
      const input = f.job(),
        result = await worker.run(input);
      renameSync(join(input.work, result.file), join(f.directory, result.file));
      await expect(
        worker.frame({
          attempt: f.attempt,
          segment: result.segment,
          sha256: result.sha256,
          index: 0,
          decoded_sha256: result.frames[0].decoded_sha256,
          width: result.height,
          height: result.width,
        }),
      ).rejects.toMatchObject({ code: "validation" });
    } finally {
      await worker.close();
      f.close();
    }
  },
  15000,
);

it.skipIf(process.platform !== "linux")(
  "refuses new encoder or reader admission after close without launching another worker",
  async () => {
    const f = await fixture(),
      worker = new MonitoringVideoProcess(f.store);
    try {
      const input = f.job(),
        result = await worker.run(input);
      renameSync(join(input.work, result.file), join(f.directory, result.file));
      await worker.close();
      await expect(worker.run(f.job())).rejects.toMatchObject({
        code: "closed",
      });
      await expect(
        worker.frame({
          attempt: f.attempt,
          segment: result.segment,
          sha256: result.sha256,
          index: 0,
          decoded_sha256: result.frames[0].decoded_sha256,
          width: result.width,
          height: result.height,
        }),
      ).rejects.toMatchObject({ code: "closed" });
      expect(worker.pids).toEqual([]);
    } finally {
      await worker.close();
      f.close();
    }
  },
  15000,
);

it.skipIf(process.platform !== "linux")(
  "batch-decodes all twelve mapped captures with both JPEG forms and refuses a wrong proof without returning partial frames",
  async () => {
    const f = await fixture(randomUUID(), 320, 240, 12),
      worker = new MonitoringVideoProcess(f.store);
    try {
      const input = f.job(),
        result = await worker.run(input);
      expect(result.duration_ms).toBe(60000);
      renameSync(join(input.work, result.file), join(f.directory, result.file));
      const indices = [11, ...Array.from({ length: 11 }, (_, index) => index)];
      const request = {
        attempt: f.attempt,
        segment: result.segment,
        sha256: result.sha256,
        width: result.width,
        height: result.height,
        frames: indices.map((index) => ({
          index,
          decoded_sha256: result.frames[index].decoded_sha256,
        })),
      };
      const before = performance.now(),
        frames = await worker.frames(request);
      console.log(
        JSON.stringify({
          video_batch_latency_ms: performance.now() - before,
          frames: frames.length,
        }),
      );
      expect(frames.map((frame) => frame.index)).toEqual(indices);
      for (const frame of frames) {
        expect(await sharp(frame.original).metadata()).toMatchObject({
          format: "jpeg",
          width: 320,
          height: 240,
        });
        expect(await sharp(frame.thumbnail).metadata()).toMatchObject({
          format: "jpeg",
          width: 256,
          height: 192,
        });
      }
      await expect(
        worker.frames({
          ...request,
          frames: request.frames.map((frame, index) =>
            index === 11 ? { ...frame, decoded_sha256: "0".repeat(64) } : frame,
          ),
        }),
      ).rejects.toMatchObject({ code: "digest" });
      await expect(
        worker.frames({
          ...request,
          frames: [request.frames[0], request.frames[0]],
        }),
      ).rejects.toMatchObject({ code: "invalid-request" });
      await worker.close();
      await expect(worker.frames(request)).rejects.toMatchObject({
        code: "closed",
      });
    } finally {
      await worker.close();
      f.close();
    }
  },
  20000,
);
