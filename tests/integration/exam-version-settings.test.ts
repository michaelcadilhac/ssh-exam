import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createApp } from "../../apps/server/src/app.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";

it("authenticated versioned web settings preserve exact source and old attempts; invalid selections never write", async () => {
  const data = mkdtempSync(tmpdir() + "/exam-version-http-"),
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
    const session = store.session("admin", "instructor", null),
      headers = {
        origin,
        cookie: `session=${session.token}`,
        "x-csrf-token": session.csrf,
      };
    const attest = (agent: string, hash: string) =>
      new TemplateCatalog(store, agent).sync(
        {
          version: {
            schema: 1,
            name: "v1",
            hash,
            entries: 4,
            files: 2,
            bytes: 30,
            max_file_bytes: 20,
            created: 1000,
          },
          reason: "Reviewed synthetic exact material source",
        },
        {
          agent,
          actor: `agent:${agent}:root`,
          request: randomUUID(),
          issued: 1000,
          observed: 1001,
        },
      );
    const first = "a".repeat(64),
      next = "b".repeat(64);
    attest("class", first);
    attest("class", next);
    attest("other", "c".repeat(64));
    const definition = {
      id: "versioned",
      name: "Versioned exam",
      template: "v1",
      template_version: first,
      duration: 5400,
      webcam: false,
      terminals: 4,
      earliest: Date.now() - 60000,
      latest: Date.now() + 3600000,
    };
    const save = (payload: any, path = "/api/admin/exams/versioned") =>
      app.inject({ method: "POST", url: path, headers, payload });
    const requestID = randomUUID();
    const created = await save({ ...definition, requestID });
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json().template_version).toBe(first);
    expect((await save({ ...definition, requestID })).json()).toEqual(
      created.json(),
    );
    const snapshot = JSON.stringify(definition);
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,preflight_started_at,last_contact) VALUES('prepared','versioned','student',10001,'PREPARING',?,?,?)",
      )
      .run(snapshot, Date.now(), Date.now());
    const original = store.attempt("prepared");
    const changed = await save({ ...created.json(), template_version: next });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().template_version).toBe(next);
    expect(store.attempt("prepared")).toEqual(original);
    for (const hash of ["c".repeat(64), "d".repeat(64), "latest", ""]) {
      const refused = await save({
        ...definition,
        id: "unknown",
        template_version: hash,
      });
      expect(refused.statusCode, refused.body).toBeGreaterThanOrEqual(400);
      expect(
        store.db.prepare("SELECT id FROM exams WHERE id='unknown'").get(),
      ).toBeUndefined();
      expect(store.attempt("prepared")).toEqual(original);
    }
    const cleared = await save(
      { ...changed.json(), template_version: "" },
      "/api/admin/exams",
    );
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json()).not.toHaveProperty("template_version");
    expect(store.attempt("prepared")).toEqual(original);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
