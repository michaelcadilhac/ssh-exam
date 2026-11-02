import { expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  symlinkSync,
  linkSync,
  mkdirSync,
  rmSync,
  truncateSync,
  rmdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { mediaFixture } from "../fixtures/monitoring-media.js";
import { MonitoringMedia } from "../../apps/server/src/monitoring-media.js";

async function fixture() {
  const dir = mkdtempSync(tmpdir() + "/monitoring-playback-"),
    f = await mediaFixture(dir);
  writeFileSync(
    dir + "/monitoring-video-deploy.pause",
    "synthetic qualification pause",
    { mode: 0o600 },
  );
  const manifest = JSON.parse(
    readFileSync(
      new URL("../fixtures/monitoring-video-v1/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const clip = readFileSync(
    new URL("../fixtures/monitoring-video-v1/segment.webm", import.meta.url),
  );
  const r = manifest.result,
    at = Date.now() - 60000;
  f.store.db
    .prepare(
      "UPDATE attempts SET start=?,deadline=?,original_deadline=? WHERE id='a'",
    )
    .run(at - 60000, at, at);
  f.store.db
    .prepare(
      "INSERT INTO monitoring_video_segments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      r.segment,
      "a",
      r.source,
      r.sha256,
      r.bytes,
      r.width,
      r.height,
      r.frames.length,
      manifest.source_bytes,
      at,
      at,
      at,
    );
  for (const [index, frame] of r.frames.entries()) {
    f.store.db
      .prepare("INSERT INTO frames VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        frame.id,
        "a",
        r.source,
        index + 1,
        "synthetic",
        at + frame.captured,
        index * 5000,
        at + frame.captured + 1,
        320,
        240,
        frame.original_hash,
      );
    f.store.db
      .prepare("INSERT INTO monitoring_video_frames VALUES(?,?,?,?)")
      .run(frame.id, r.segment, index, frame.decoded_sha256);
  }
  const path = dir + "/monitoring/a/" + r.segment + ".webm";
  writeFileSync(path, clip, { mode: 0o600 });
  const url = "/api/admin/attempts/a/videos/" + r.segment;
  const before = f.store.attempt("a"),
    framesBefore = f.store.db.prepare("SELECT * FROM frames ORDER BY id").all();
  writeFileSync(
    dir + "/submissions/protected",
    "PROTECTED-SYNTHETIC-SUBMISSION",
    { mode: 0o600 },
  );
  return {
    ...f,
    dir,
    manifest,
    clip,
    path,
    url,
    before,
    framesBefore,
    async close() {
      expect(f.store.attempt("a")).toEqual(before);
      expect(readFileSync(dir + "/submissions/protected", "utf8")).toBe(
        "PROTECTED-SYNTHETIC-SUBMISSION",
      );
      await f.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

it("serves actual verified VP9 bytes only to instructors and binds clips to their attempt", async () => {
  const f = await fixture();
  try {
    const video = await f.app.inject({ url: f.url, headers: f.headers });
    expect(video.statusCode).toBe(200);
    expect(video.headers["content-type"]).toContain("video/webm");
    expect(video.headers["cache-control"]).toBe("no-store");
    expect(video.rawPayload).toEqual(f.clip);
    expect(video.rawPayload.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
    expect((await f.app.inject({ url: f.url })).statusCode).toBe(401);
    const student = f.store.session("student", "synthetic", "e");
    expect(
      (
        await f.app.inject({
          url: f.url,
          headers: { cookie: `session=${student.token}` },
        })
      ).statusCode,
    ).toBe(401);
    f.store.db.exec(
      "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('b','e','other',1002,'COMPLETED','{}')",
    );
    expect(
      (
        await f.app.inject({
          url: f.url.replace("/a/", "/b/"),
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(404);
    for (const url of [
      f.url + "?extra=1",
      f.url.replace(f.manifest.result.segment, "not-a-uuid"),
    ])
      expect((await f.app.inject({ url, headers: f.headers })).statusCode).toBe(
        400,
      );
    expect(
      (
        await f.app.inject({
          url: f.url.replace(f.manifest.result.segment, randomUUID()),
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      f.store.db.prepare("SELECT * FROM frames ORDER BY id").all(),
    ).toEqual(f.framesBefore);
  } finally {
    await f.close();
  }
});

it("publishes original capture times and exact segment offsets alongside unchanged JPEG-only entries", async () => {
  const f = await fixture();
  try {
    const result = await f.app.inject({
      url: "/api/admin/attempts/a/recordings",
      headers: f.headers,
    });
    expect(result.statusCode).toBe(200);
    const frames = result.json().frames;
    for (const [index, frame] of f.manifest.result.frames.entries()) {
      const original = f.framesBefore.find(
        (row: any) => row.id === frame.id,
      ) as any;
      expect(frames.find((row: any) => row.id === frame.id)).toMatchObject({
        ...original,
        video: {
          segment: f.manifest.result.segment,
          offset_ms: index * 5000,
          duration_ms: 15000,
        },
      });
    }
    expect(
      frames.find((row: any) => row.id === f.frame.id).video,
    ).toBeUndefined();
    expect(
      (
        await f.app.inject({
          url: `/api/admin/media/${f.frame.id}`,
          headers: f.headers,
        })
      ).rawPayload,
    ).toEqual(f.data);
  } finally {
    await f.close();
  }
});

it("refuses corrupt, oversized, linked, redirected and special clip files without stalling health", async () => {
  const f = await fixture();
  try {
    const protectedPath = f.dir + "/submissions/protected";
    for (const corrupt of [
      () =>
        writeFileSync(f.path, Buffer.alloc(f.clip.length, 7), { mode: 0o600 }),
      () => {
        writeFileSync(f.path, "", { mode: 0o600 });
        truncateSync(f.path, 33 * 1024 * 1024);
      },
      () => symlinkSync(protectedPath, f.path),
      () => linkSync(protectedPath, f.path),
      () => mkdirSync(f.path, { mode: 0o700 }),
    ]) {
      unlinkSync(f.path);
      corrupt();
      const [refused, health] = await Promise.all([
        f.app.inject({ url: f.url, headers: f.headers }),
        f.app.inject({ url: "/health/live" }),
      ]);
      expect(refused.statusCode).toBe(503);
      expect(health.statusCode).toBe(200);
      expect(refused.body).not.toContain("PROTECTED-SYNTHETIC-SUBMISSION");
      expect(refused.body).not.toContain(f.dir);
      try {
        rmdirSync(f.path);
      } catch {
        unlinkSync(f.path);
      }
      writeFileSync(f.path, f.clip, { mode: 0o600 });
      expect(
        (await f.app.inject({ url: f.url, headers: f.headers })).rawPayload,
      ).toEqual(f.clip);
    }
  } finally {
    await f.close();
  }
});

it("refuses a clip with inconsistent frame mapping and permits an inspected metadata repair", async () => {
  const f = await fixture();
  try {
    f.store.db
      .prepare(
        "UPDATE monitoring_video_segments SET source='screen' WHERE id=?",
      )
      .run(f.manifest.result.segment);
    expect(
      (await f.app.inject({ url: f.url, headers: f.headers })).statusCode,
    ).toBe(503);
    expect(
      (
        await f.app.inject({
          url: "/api/admin/attempts/a/recordings",
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(503);
    f.store.db
      .prepare(
        "UPDATE monitoring_video_segments SET source='webcam' WHERE id=?",
      )
      .run(f.manifest.result.segment);
    expect(
      (await f.app.inject({ url: f.url, headers: f.headers })).rawPayload,
    ).toEqual(f.clip);
  } finally {
    await f.close();
  }
});

it("rechecks deletion after the async clip read and before publishing any private bytes", async () => {
  const f = await fixture(),
    original = MonitoringMedia.prototype.clip;
  const spy = vi
    .spyOn(MonitoringMedia.prototype, "clip")
    .mockImplementation(async function (this: MonitoringMedia, ...args) {
      const result = await original.apply(this, args);
      f.store.db
        .prepare("INSERT INTO tombstones VALUES('a',?)")
        .run(Date.now());
      return result;
    });
  try {
    const refused = await f.app.inject({ url: f.url, headers: f.headers });
    expect(refused.statusCode).toBe(410);
    expect(refused.rawPayload).not.toEqual(f.clip);
    const inventory = await f.app.inject({
      url: "/api/admin/attempts/a/recordings",
      headers: f.headers,
    });
    expect(inventory.json().frames).toEqual([]);
  } finally {
    spy.mockRestore();
    await f.close();
  }
});
