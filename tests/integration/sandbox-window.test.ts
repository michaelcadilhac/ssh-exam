import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createApp } from "../../apps/server/src/app.js";
import { hash } from "../../apps/server/src/db.js";

it("web sandbox settings preserve an explicit window, reject indefinite policy and leave saved attempts unchanged", async () => {
  const data = mkdtempSync(tmpdir() + "/sandbox-window-");
  const origin = "http://localhost:3000";
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
  try {
    const admin = store.session("admin", "instructor", null);
    const headers = {
      origin,
      cookie: `session=${admin.token}`,
      "x-csrf-token": admin.csrf,
    };
    const list = () => app.inject({ url: "/api/admin/exams", headers });
    const initial = (await list()).json().find((e: any) => e.id === "sandbox");
    expect(initial.latest).toBeLessThan(Date.now());
    const earliest = Date.now() - 60000,
      latest = Date.now() + 60000;
    const settings = {
      ...initial,
      earliest,
      latest,
      duration: 7200,
      webcam: true,
    };
    const saved = await app.inject({
      method: "POST",
      url: "/api/admin/exams",
      headers,
      payload: { ...settings, requestID: randomUUID() },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      earliest,
      latest,
      duration: 300,
      webcam: false,
    });
    const savedSettings = saved.json<any>();
    const snapshot = JSON.stringify(savedSettings);
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid) VALUES('sandbox','student',10001)",
      )
      .run();
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,page_hash,last_contact,preflight_started_at) VALUES('preflight','sandbox','student',10001,'PREPARING',?,?,?,?)",
      )
      .run(snapshot, hash("page"), Date.now(), Date.now());
    const before = store.attempt("preflight");
    const invalid = await app.inject({
      method: "POST",
      url: "/api/admin/exams",
      headers,
      payload: { ...savedSettings, earliest: 0, latest: 8640000000000000 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toMatch(/finite.*window/i);
    const changed = await app.inject({
      method: "POST",
      url: "/api/admin/exams",
      headers,
      payload: {
        ...savedSettings,
        earliest: latest + 60000,
        latest: latest + 120000,
      },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(store.attempt("preflight")).toEqual(before);
    expect(
      (await list()).json().find((e: any) => e.id === "sandbox"),
    ).toMatchObject({ earliest: latest + 60000, latest: latest + 120000 });

    // Authenticated actual Begin endpoint must reject before SSH or activation,
    // even for a legacy saved preparation; current defaults cannot substitute.
    const student = store.session("student", "student", "sandbox");
    const studentHeaders = {
      origin,
      cookie: `session=${student.token}`,
      "x-csrf-token": student.csrf,
      "x-page-instance": "page",
    };
    for (const window of [
      { earliest: 0, latest: 8640000000000000 },
      { earliest: Date.now() + 60000, latest: Date.now() + 120000 },
      { earliest: Date.now() - 120000, latest: Date.now() - 60000 },
    ]) {
      store.db
        .prepare("UPDATE attempts SET settings=? WHERE id='preflight'")
        .run(JSON.stringify({ ...savedSettings, ...window }));
      const reply = await app.inject({
        method: "POST",
        url: "/api/student/attempts/preflight/begin",
        headers: studentHeaders,
        payload: {
          screen: true,
          keyboard: true,
          fullscreen: true,
          focus: true,
          visible: true,
          webcam: false,
        },
      });
      expect(reply.statusCode).toBe(400);
      expect(reply.json().error).toMatch(/window/i);
      expect(store.attempt("preflight")).toMatchObject({
        state: "PREPARING",
        start: null,
        deadline: null,
        original_deadline: null,
      });
    }
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
