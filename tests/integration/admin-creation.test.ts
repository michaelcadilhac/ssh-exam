import { expect, it } from "vitest";
import argon2 from "argon2";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { createApp } from "../../apps/server/src/app.js";

async function setup() {
  const dir = mkdtempSync(tmpdir() + "/admin-creation-");
  let logs = "";
  const { app, store } = await createApp(
    {
      mode: "development",
      origin: "http://localhost:3000",
      data: dir,
      port: 3000,
      jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
      class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
      agent: {
        id: "class",
        signingKey: "/missing",
        callbackPublicKey: "/missing",
      },
      maintenance: false,
    },
    {
      logStream: new Writable({
        write(chunk, _encoding, done) {
          logs += chunk.toString();
          done();
        },
      }),
    },
  );
  const owner = store.session("admin", "owner", null);
  const headers = {
    cookie: `session=${owner.token}`,
    origin: "http://localhost:3000",
    "x-csrf-token": owner.csrf,
  };
  const create = (payload: any, requestHeaders = headers) =>
    app.inject({
      method: "POST",
      url: "/api/admin/administrators",
      headers: requestHeaders,
      payload,
    });
  return {
    app,
    store,
    dir,
    headers,
    create,
    logs: () => logs,
    close: async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

it("allows only authenticated administrators with same-origin CSRF protection to create admins", async () => {
  const t = await setup();
  try {
    const payload = {
      username: "new-admin",
      password: "new-admin-secret-password",
    };
    expect(
      (await t.create(payload, { ...t.headers, cookie: "" })).statusCode,
    ).toBe(401);
    const student = t.store.session("student", "student", "sandbox");
    expect(
      (
        await t.create(payload, {
          ...t.headers,
          cookie: `session=${student.token}`,
          "x-csrf-token": student.csrf,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await t.create(payload, { ...t.headers, "x-csrf-token": "wrong" }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await t.create(payload, {
          ...t.headers,
          origin: "https://evil.invalid",
        })
      ).statusCode,
    ).toBe(403);
    expect(t.store.db.prepare("SELECT * FROM admins").all()).toHaveLength(0);
    expect((await t.create(payload)).statusCode).toBe(201);
  } finally {
    await t.close();
  }
});

it("hashes and audits creation, permits sign-in, rejects unsafe inputs without exposing secrets", async () => {
  const t = await setup();
  const password = "never-log-this-admin-password";
  try {
    for (const payload of [
      { username: "", password },
      { username: "invalid name", password },
      { username: "x".repeat(65), password },
      { username: "valid", password: "short" },
      { username: "valid", password: "x".repeat(1025) },
      { username: "valid" },
    ]) {
      const result = await t.create(payload);
      expect(result.statusCode).toBe(400);
      expect(result.body).not.toContain(password);
    }
    const created = await t.create({ username: "new_admin-2", password });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ username: "new_admin-2" });
    const row = t.store.db.prepare("SELECT * FROM admins").get() as any;
    expect(row.hash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(row.hash, password)).toBe(true);
    const audit = t.store.db
      .prepare("SELECT * FROM audit WHERE action='create-admin'")
      .all();
    expect(audit).toEqual([
      expect.objectContaining({
        actor: "owner",
        target: "new_admin-2",
        detail: "",
      }),
    ]);
    const login = await t.app.inject({
      method: "POST",
      url: "/api/admin/login",
      headers: { origin: t.headers.origin },
      payload: { username: "new_admin-2", password },
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const session = await t.app.inject({
      url: "/api/session",
      headers: { cookie },
    });
    expect(session.json()).toMatchObject({
      role: "admin",
      username: "new_admin-2",
    });
    expect(
      (await t.app.inject({ url: "/api/admin/exams", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    expect(t.logs()).toContain("request completed");
    expect(t.logs()).not.toContain(password);
    expect(t.logs()).not.toContain(row.hash);
    const checkFiles = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name);
        if (entry.isDirectory()) checkFiles(file);
        else
          expect(readFileSync(file).includes(Buffer.from(password))).toBe(
            false,
          );
      }
    };
    checkFiles(t.dir);
  } finally {
    await t.close();
  }
});

it("never overwrites an existing administrator under duplicate or concurrent creation", async () => {
  const t = await setup();
  try {
    const firstPassword = "first-creation-password",
      secondPassword = "second-creation-password";
    const results = await Promise.all([
      t.create({ username: "same-admin", password: firstPassword }),
      t.create({ username: "same-admin", password: secondPassword }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const row = t.store.db.prepare("SELECT * FROM admins").get() as any;
    const winner =
      results[0].statusCode === 201 ? firstPassword : secondPassword;
    expect(await argon2.verify(row.hash, winner)).toBe(true);
    const duplicate = await t.create({
      username: "same-admin",
      password: "replacement-password",
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toContain("already exists");
    expect(t.store.db.prepare("SELECT * FROM admins").all()).toEqual([row]);
    expect(
      t.store.db
        .prepare("SELECT * FROM audit WHERE action='create-admin'")
        .all(),
    ).toHaveLength(1);
  } finally {
    await t.close();
  }
});
