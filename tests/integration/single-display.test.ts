import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../../apps/server/src/app.js";
import { hash } from "../../apps/server/src/db.js";

it("authenticated preflight captures and Start/resume enforce the current display policy without consuming time", async () => {
  const data = mkdtempSync(tmpdir() + "/single-display-"),
    origin = "http://127.0.0.1";
  const { app, store } = await createApp({
    mode: "development",
    origin,
    data,
    port: 0,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
    agent: { id: "class", signingKey: "/unused", callbackPublicKey: "/unused" },
  });
  const id = randomUUID(),
    preparation = randomUUID(),
    page = randomUUID(),
    settings = JSON.stringify({ webcam: false });
  store.db
    .prepare("INSERT INTO exams VALUES('synthetic',?)")
    .run(JSON.stringify({ single_display: true }));
  store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,page_hash,start,deadline,original_deadline,last_contact) VALUES(?,'synthetic','displaytest',10001,'ACTIVE',?,?,?,?,?,?)",
    )
    .run(
      id,
      settings,
      hash(page),
      Date.now() - 1000,
      Date.now() + 600000,
      Date.now() + 600000,
      Date.now(),
    );
  store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,page_hash,preflight_started_at,last_contact) VALUES(?,'synthetic','displaypreflight',10002,'PREPARING',?,?,?,?)",
    )
    .run(preparation, settings, hash(page), Date.now(), Date.now());
  const session = store.session("student", "displaytest", "synthetic"),
    headers = {
      origin,
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrf,
      "x-page-instance": page,
    };
  const prepSession = store.session("student", "displaypreflight", "synthetic");
  const prepHeaders = {
    ...headers,
    cookie: `session=${prepSession.token}`,
    "x-csrf-token": prepSession.csrf,
  };
  const prefix = `/api/student/attempts/${id}`,
    original = store.attempt(id);
  const ready = {
    fullscreen: true,
    visible: true,
    focus: true,
    keyboard: true,
    screen: true,
    webcam: false,
  };
  const jpeg = (
    await sharp({
      create: { width: 40, height: 30, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer()
  ).toString("base64");
  let seq = 0;
  const capture = async (display?: string) => {
    const challenge = await app.inject({
      method: "POST",
      url: prefix + "/capture-challenges",
      headers,
      payload: { source: "screen" },
    });
    expect(challenge.statusCode, challenge.body).toBe(200);
    const frame = await app.inject({
      method: "POST",
      url: prefix + "/frames/challenged",
      headers,
      payload: {
        source: "screen",
        seq: ++seq,
        captured: Date.now(),
        monotonic: seq,
        data: jpeg,
        challenge: challenge.json().challenge,
        readiness: { ...ready, ...(display ? { display } : {}) },
      },
    });
    expect(frame.statusCode, frame.body).toBe(200);
    return frame.json().monitoring.complete;
  };
  try {
    for (const display of [undefined, "unavailable", "multiple"]) {
      expect(await capture(display)).toBe(false);
      const response = await app.inject({
        method: "POST",
        url: `/api/student/attempts/${preparation}/begin`,
        headers: prepHeaders,
        payload: { ...ready, ...(display ? { display } : {}) },
      });
      expect(response.statusCode, response.body).toBeGreaterThanOrEqual(400);
      expect(response.json().error).toMatch(/display/);
      expect(store.attempt(preparation)).toMatchObject({
        state: "PREPARING",
        start: null,
        deadline: null,
        settings: original.settings,
        grant_id: original.grant_id,
      });
    }
    expect(await capture("single")).toBe(true);
    const status = await app.inject({ url: prefix + "/status", headers });
    expect(status.statusCode, status.body).toBe(200);
    // Active setting changes invalidate old preflight observations; no snapshot rewrite.
    store.db.prepare("UPDATE exams SET config='{}' WHERE id='synthetic'").run();
    expect(await capture()).toBe(true);
    store.db
      .prepare(
        "UPDATE exams SET config='{\"single_display\":true}' WHERE id='synthetic'",
      )
      .run();
    const stale = await app.inject({
      url: prefix + "/monitoring-readiness",
      headers,
    });
    expect(stale.json().complete).toBe(false);
    expect(await capture("single")).toBe(true);
    store.db
      .prepare(
        "UPDATE attempts SET state='LOCKED',start=?,deadline=?,original_deadline=? WHERE id=?",
      )
      .run(Date.now(), Date.now() + 600000, Date.now() + 600000, id);
    const before = store.attempt(id);
    const resume = await app.inject({
      method: "POST",
      url: prefix + "/continue",
      headers,
      payload: ready,
    });
    expect(resume.statusCode, resume.body).toBeGreaterThanOrEqual(400);
    expect(resume.json().error).toMatch(/one display/);
    expect(store.attempt(id).deadline).toBe(before.deadline);
    expect(store.attempt(id).generation).toBe(before.generation);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
