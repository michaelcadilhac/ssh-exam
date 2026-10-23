import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../../apps/server/src/app.js";
import { hash } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";

// Only the evidence clock is synthetic. HTTP authentication/page checks and
// actual JPEG decoding/storage run normally; this is not native permission.
const clock = vi.hoisted(() => ({ now: 10000 }));
vi.mock("../../apps/server/src/monitoring-clock.js", () => ({
  monitoringBootTimeMS: () => clock.now,
}));
afterEach(() => {
  clock.now = 10000;
});

it.each([false, true])(
  "challenged HTTP captures preserve freshness/retry/scope (webcam=%s)",
  async (webcam) => {
    const data = mkdtempSync(tmpdir() + "/capture-readiness-"),
      origin = "http://127.0.0.1";
    const { app, store } = await createApp({
      mode: "development",
      origin,
      data,
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
      start = Date.now(),
      settings = JSON.stringify({ webcam });
    store.db.exec("INSERT INTO exams VALUES('e','{}')");
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,page_hash) VALUES(?,'e','synthetic',10001,'ACTIVE',?,?,?,?,?)",
      )
      .run(id, settings, start, start + 600000, start + 600000, hash(page));
    const session = store.session("student", "synthetic", "e"),
      headers = {
        origin,
        cookie: `session=${session.token}`,
        "x-csrf-token": session.csrf,
        "x-page-instance": page,
      },
      url = `/api/student/attempts/${id}`;
    const jpeg = (
      await sharp({
        create: { width: 40, height: 30, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer()
    ).toString("base64");
    const readiness = {
      fullscreen: true,
      visible: true,
      keyboard: true,
      focus: true,
      screen: true,
      webcam,
    };
    try {
      const challenge = await app.inject({
        method: "POST",
        url: url + "/capture-challenges",
        headers,
        payload: { source: "screen" },
      });
      expect(challenge.statusCode, challenge.body).toBe(200);
      const ticket = challenge.json();
      expect(ticket).toMatchObject({ source: "screen", after_sequence: 0 });
      const frame = {
        source: "screen",
        seq: 1,
        captured: Date.now(),
        monotonic: 1,
        data: jpeg,
        challenge: ticket.challenge,
        readiness,
      };
      const upload = await app.inject({
        method: "POST",
        url: url + "/frames/challenged",
        headers,
        payload: frame,
      });
      expect(upload.statusCode, upload.body).toBe(200);
      expect(upload.json().monitoring).toMatchObject({
        complete: !webcam,
        age_ms: webcam ? null : 0,
        observation_only: true,
      });
      clock.now += 4000;
      const retry = await app.inject({
        method: "POST",
        url: url + "/frames/challenged",
        headers,
        payload: frame,
      });
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json().id).toBe(upload.json().id);
      expect(retry.json().monitoring.age_ms).toBe(webcam ? null : 4000);
      if (webcam) {
        const camera = await app.inject({
          method: "POST",
          url: url + "/capture-challenges",
          headers,
          payload: { source: "webcam" },
        });
        expect(camera.statusCode, camera.body).toBe(200);
        const cameraFrame = await app.inject({
          method: "POST",
          url: url + "/frames/challenged",
          headers,
          payload: {
            ...frame,
            source: "webcam",
            challenge: camera.json().challenge,
          },
        });
        expect(cameraFrame.statusCode, cameraFrame.body).toBe(200);
        expect(cameraFrame.json().monitoring).toMatchObject({
          complete: true,
          age_ms: 4000,
        });
      }
      const late = await app.inject({
        method: "POST",
        url: url + "/capture-challenges",
        headers,
        payload: { source: "screen" },
      });
      expect(late.statusCode, late.body).toBe(200);
      expect(late.json().after_sequence).toBe(1);
      const retag = await app.inject({
        method: "POST",
        url: url + "/frames/challenged",
        headers,
        payload: { ...frame, challenge: late.json().challenge },
      });
      expect(retag.statusCode).toBe(409);
      expect(retag.json().code).toBe("monitoring_challenge_sequence");
      clock.now += 15001;
      const expired = await app.inject({
        method: "POST",
        url: url + "/frames/challenged",
        headers,
        payload: {
          ...frame,
          seq: 2,
          challenge: late.json().challenge,
          captured: Date.now(),
        },
      });
      expect(expired.statusCode).toBe(409);
      expect(expired.json()).toMatchObject({
        code: "monitoring_challenge_expired",
      });
      const other = await app.inject({
        method: "POST",
        url: url + "/capture-challenges",
        headers: { ...headers, "x-page-instance": randomUUID() },
        payload: { source: "screen" },
      });
      expect(other.statusCode).toBe(403);
      const count = () =>
        (
          store.db
            .prepare("SELECT COUNT(*) n FROM frames WHERE attempt=?")
            .get(id) as { n: number }
        ).n;
      expect(count()).toBe(webcam ? 2 : 1);
      const next = async () => {
        const response = await app.inject({
          method: "POST",
          url: url + "/capture-challenges",
          headers,
          payload: { source: "screen" },
        });
        expect(response.statusCode, response.body).toBe(200);
        return response.json();
      };
      const post = (payload: any) =>
        app.inject({
          method: "POST",
          url: url + "/frames/challenged",
          headers,
          payload,
        });
      const fresh = await next();
      const badImage = await post({
        ...frame,
        seq: 2,
        challenge: fresh.challenge,
        data: Buffer.alloc(64, "x").toString("base64"),
      });
      expect(badImage.statusCode).toBe(400);
      expect(count()).toBe(webcam ? 2 : 1);
      // Bad image validation cannot consume a challenge or establish readiness.
      const second = { ...frame, seq: 2, challenge: fresh.challenge };
      const recorded = await post(second);
      expect(recorded.statusCode, recorded.body).toBe(200);
      const changedPolicy = await post({
        ...second,
        readiness: { ...readiness, focus: false },
      });
      expect(changedPolicy.statusCode).toBe(409);
      expect(changedPolicy.json().code).toBe("monitoring_challenge_conflict");
      const oldGeneration = await next();
      store.db.prepare("UPDATE attempts SET generation=1 WHERE id=?").run(id);
      const generationRefusal = await post({
        ...frame,
        seq: 3,
        challenge: oldGeneration.challenge,
      });
      expect(generationRefusal.statusCode).toBe(409);
      expect(generationRefusal.json().code).toBe("monitoring_challenge_scope");
      const duringDecode = await next();
      let entered = false,
        release!: () => void,
        completed: any;
      const gate = new Promise<void>((resolve) => {
          release = resolve;
        }),
        original = sharp.prototype.toBuffer;
      const decode = vi
        .spyOn(sharp.prototype, "toBuffer")
        .mockImplementationOnce(function (this: any, ...args: any[]) {
          entered = true;
          return gate.then(() => Reflect.apply(original, this, args));
        } as any);
      const pending = post({
        ...frame,
        seq: 3,
        challenge: duringDecode.challenge,
      }).then((response) => {
        completed = response;
        return response;
      });
      try {
        await vi.waitFor(() => expect(entered).toBe(true), { timeout: 2000 });
        // Change only the synthetic record after the precise JPEG boundary.
        store.db.prepare("UPDATE attempts SET generation=2 WHERE id=?").run(id);
        release();
        await vi.waitFor(() => expect(completed).toBeDefined(), {
          timeout: 3000,
        });
        expect(completed.statusCode).toBe(409);
        expect(completed.json().code).toBe("monitoring_challenge_scope");
      } finally {
        release();
        decode.mockRestore();
        await pending;
      }
      expect(count()).toBe(webcam ? 3 : 2);
      if (!webcam) {
        const beforeDelete = await next();
        const accepted = await post({
          ...frame,
          seq: 3,
          challenge: beforeDelete.challenge,
        });
        expect(accepted.statusCode, accepted.body).toBe(200);
        expect(accepted.json().monitoring.complete).toBe(true);
        new Monitoring(store).delete(id, "synthetic-instructor");
        const deleted = await app.inject({
          url: url + "/monitoring-readiness",
          headers,
        });
        expect(deleted.statusCode).toBe(409);
        const noResurrection = await post({
          ...frame,
          seq: 3,
          challenge: beforeDelete.challenge,
        });
        expect(noResurrection.statusCode).toBe(409);
      }
      const interval = store.attempt(id);
      expect(interval).toMatchObject({
        state: "ACTIVE",
        start,
        deadline: start + 600000,
        original_deadline: start + 600000,
      });
    } finally {
      await app.close();
      store.close();
      rmSync(data, { recursive: true, force: true });
    }
  },
);
