import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../../apps/server/src/app.js";
import { hash } from "../../apps/server/src/db.js";

it("new smaller JPEG captures retain exact challenged hashes and metadata alongside full-size legacy images", async () => {
  const dir = mkdtempSync(tmpdir() + "/capture-profile-http-"),
    origin = "http://127.0.0.1",
    { app, store } = await createApp({
      mode: "development",
      origin,
      data: dir,
      port: 0,
      maintenance: false,
      jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
      class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
      agent: {
        id: "class",
        signingKey: "/unused",
        callbackPublicKey: "/unused",
      },
    });
  const id = randomUUID(),
    page = randomUUID(),
    start = Date.now();
  store.db.exec("INSERT INTO exams VALUES('e','{}')");
  store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,page_hash) VALUES(?,'e','synthetic',10001,'ACTIVE',?,?,?,?,?)",
    )
    .run(
      id,
      JSON.stringify({ webcam: true }),
      start,
      start + 600000,
      start + 600000,
      hash(page),
    );
  const student = store.session("student", "synthetic", "e"),
    instructor = store.session("admin", "teacher", null),
    headers = {
      origin,
      cookie: `session=${student.token}`,
      "x-csrf-token": student.csrf,
      "x-page-instance": page,
    },
    adminHeaders = { cookie: `session=${instructor.token}` },
    url = `/api/student/attempts/${id}`,
    before = store.attempt(id),
    retained = new Map<string, Buffer>();
  try {
    for (const [source, width, height, quality, challenged] of [
      ["screen", 2560, 1440, 75, false],
      ["screen", 1280, 720, 50, true],
      ["webcam", 320, 240, 50, true],
    ] as const) {
      const jpeg = await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: source === "screen" ? "#14283f" : "#9b7560",
        },
      })
        .jpeg({ quality })
        .toBuffer();
      let challenge: any;
      if (challenged) {
        const response = await app.inject({
          method: "POST",
          url: url + "/capture-challenges",
          headers,
          payload: { source },
        });
        expect(response.statusCode, response.body).toBe(200);
        challenge = response.json();
      }
      const captured = Date.now(),
        monotonic = source === "screen" ? 1234.5 : 5678.25,
        frame = {
          source,
          seq: challenged ? challenge.after_sequence + 1 : 1,
          captured,
          monotonic,
          data: jpeg.toString("base64"),
          ...(challenged
            ? {
                challenge: challenge.challenge,
                readiness: {
                  fullscreen: true,
                  visible: true,
                  keyboard: true,
                  focus: true,
                  screen: true,
                  webcam: true,
                },
              }
            : {}),
        },
        post = (payload: typeof frame) =>
          app.inject({
            method: "POST",
            url: url + (challenged ? "/frames/challenged" : "/frames"),
            headers,
            payload,
          }),
        uploaded = await post(frame);
      expect(uploaded.statusCode, uploaded.body).toBe(200);
      const result = uploaded.json();
      expect(result.hash).toBe(hash(jpeg));
      const row = store.db
        .prepare("SELECT * FROM frames WHERE id=?")
        .get(result.id) as any;
      expect(row).toMatchObject({
        attempt: id,
        source,
        seq: frame.seq,
        captured,
        monotonic,
        width,
        height,
        hash: hash(jpeg),
      });
      expect(row.received).toBeGreaterThanOrEqual(captured);
      expect(readFileSync(`${dir}/monitoring/${id}/${result.id}.jpg`)).toEqual(
        jpeg,
      );
      const retry = await post(frame);
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json().id).toBe(result.id);
      const changed = await sharp(jpeg).negate().jpeg().toBuffer(),
        conflict = await post({ ...frame, data: changed.toString("base64") });
      expect(conflict.statusCode).toBeGreaterThanOrEqual(400);
      expect(conflict.statusCode).toBeLessThan(500);
      if (challenged)
        expect(conflict.json().code).toBe("monitoring_challenge_conflict");
      else
        expect(conflict.json().error).toContain("Conflicting duplicate image");
      const original = await app.inject({
        url: `/api/admin/media/${result.id}`,
        headers: adminHeaders,
      });
      expect(original.statusCode, original.body).toBe(200);
      expect(original.headers["content-type"]).toContain("image/jpeg");
      expect(original.headers["cache-control"]).toContain("no-store");
      expect(original.rawPayload).toEqual(jpeg);
      const thumbnail = await app.inject({
        url: `/api/admin/media/${result.id}?thumbnail=1`,
        headers: adminHeaders,
      });
      expect(thumbnail.statusCode, thumbnail.body).toBe(200);
      expect((await sharp(thumbnail.rawPayload).metadata()).format).toBe(
        "jpeg",
      );
      retained.set(result.id, jpeg);
    }
    const inventory = await app.inject({
      url: `/api/admin/attempts/${id}/monitoring/entries?section=frames`,
      headers: adminHeaders,
    });
    expect(inventory.statusCode, inventory.body).toBe(200);
    expect(inventory.json().entries).toHaveLength(3);
    expect(store.attempt(id)).toEqual(before);
    for (const [frame, jpeg] of retained)
      expect(readFileSync(`${dir}/monitoring/${id}/${frame}.jpg`)).toEqual(
        jpeg,
      );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
