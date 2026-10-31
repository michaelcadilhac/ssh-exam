import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";

it("enrollment saves the initial grant immediately; defaults/roster edits do not revise it, explicit revision and revoke do", async () => {
  const data = mkdtempSync(tmpdir() + "/initial-grant-"),
    origin = "http://localhost:3000";
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
    const digest = "a".repeat(64);
    new TemplateCatalog(store, "class").sync(
      {
        version: {
          schema: 1,
          name: "v1",
          hash: digest,
          entries: 4,
          files: 2,
          bytes: 30,
          max_file_bytes: 20,
          created: 1000,
        },
        reason: "Synthetic reviewed initial grant source",
      },
      {
        agent: "class",
        actor: "agent:class:root",
        request: randomUUID(),
        issued: 1000,
        observed: 1001,
      },
    );
    const settings = {
      id: "ordinary",
      name: "Initial grant fixture",
      template: "v1",
      template_version: digest,
      duration: 5400,
      webcam: true,
      terminals: 2,
      earliest: Date.now() - 10000,
      latest: Date.now() + 3600000,
      collection_file_mib: 128,
      collection_total_mib: 512,
    };
    store.db
      .prepare("INSERT INTO exams VALUES('ordinary',?)")
      .run(JSON.stringify(settings));
    const s = store.session("admin", "instructor", null),
      headers = {
        origin,
        cookie: `session=${s.token}`,
        "x-csrf-token": s.csrf,
      };
    const post = (url: string, payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url, headers, payload });
    const enrolled = await post("/api/admin/exams/ordinary/roster/add", {
      username: "student",
      webcam: false,
      duration: 7200,
    });
    expect(enrolled.statusCode, enrolled.body).toBe(200);
    const listed = await app.inject({
      url: "/api/admin/exams/ordinary/grants?username=student",
      headers,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    const grant = listed.json().grants[0];
    expect(() =>
      store.db
        .prepare(
          "INSERT INTO enrollments(exam,username,uid) VALUES('ordinary','oldwriter',0)",
        )
        .run(),
    ).toThrow("atomic initial grant issuance");
    expect(
      store.db
        .prepare("SELECT 1 FROM enrollments WHERE username='oldwriter'")
        .get(),
    ).toBeUndefined();
    expect(() =>
      store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('oldwriter-attempt','ordinary','student',10001,'PREPARING','{}')",
        )
        .run(),
    ).toThrow("Grant-aware preparation required");
    expect(grant).toMatchObject({
      agent: "class",
      exam: "ordinary",
      username: "student",
      revision: 1,
      status: "AVAILABLE",
      settings: { ...settings, duration: 7200, webcam: false },
      work: { kind: "template", name: "v1", hash: digest },
    });
    expect(
      store.db.prepare("SELECT count(*) AS n FROM attempts").get(),
    ).toEqual({ n: 0 });
    store.db
      .prepare("UPDATE exams SET config=? WHERE id='ordinary'")
      .run(JSON.stringify({ ...settings, duration: 3600, webcam: false }));
    expect(
      (
        await post("/api/admin/exams/ordinary/roster/settings", {
          usernames: ["student"],
          duration: 4500,
          webcam: true,
        })
      ).statusCode,
    ).toBe(200);
    const show = () =>
      app.inject({ url: `/api/admin/grants/${grant.id}`, headers });
    expect((await show()).json().settings).toEqual(grant.settings);
    const request = randomUUID(),
      change = {
        revision: 1,
        changes: { duration: 4500 },
        reason: "Explicitly revise unused initial allowance",
        request,
      };
    const revised = await post(`/api/admin/grants/${grant.id}/revise`, change);
    expect(revised.statusCode, revised.body).toBe(200);
    expect(revised.json()).toMatchObject({
      revision: 2,
      settings: { duration: 4500, webcam: false },
    });
    expect(
      (await post(`/api/admin/grants/${grant.id}/revise`, change)).json(),
    ).toEqual(revised.json());
    const staleRevision = await post(`/api/admin/grants/${grant.id}/revise`, {
      ...change,
      request: randomUUID(),
    });
    expect(staleRevision.statusCode).toBe(409);
    expect(staleRevision.json().error).toBe(
      "This attempt is unavailable or its settings changed. Refresh its current status.",
    );
    expect((await show()).json()).toEqual(revised.json());
    const revoked = await post(`/api/admin/grants/${grant.id}/revoke`, {
      revision: 2,
      reason: "Withdraw this unused initial grant",
      request: randomUUID(),
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect(revoked.json().status).toBe("REVOKED");
    expect((await show()).json().history).toHaveLength(2);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
