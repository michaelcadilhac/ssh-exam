import { expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { createApp } from "../../apps/server/src/app.js";

async function fixture() {
  const data = mkdtempSync(tmpdir() + "/classroom-bootstrap-");
  const result = await createApp(
    {
      mode: "development",
      origin: "http://localhost:3000",
      data,
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
        write(_chunk, _encoding, done) {
          done();
        },
      }),
    },
  );
  return {
    ...result,
    close: async () => {
      await result.app.close();
      rmSync(data, { recursive: true, force: true });
    },
  };
}

it("admits seventy anonymous classroom page loads behind one NAT without creating authority", async () => {
  expect(existsSync("dist/web/index.html"), "Build the web fixture first").toBe(
    true,
  );
  const t = await fixture();
  try {
    for (let student = 0; student < 70; student++) {
      for (const [url, status] of [
        ["/", 200],
        ["/api/session", 401],
        ["/api/login-test", 200],
        ["/favicon.svg", 200],
      ] as const) {
        const reply = await t.app.inject({
          url,
          remoteAddress: "198.51.100.70",
        });
        expect(reply.statusCode, `student ${student + 1}: ${url}`).toBe(status);
      }
    }
    for (const table of ["attempts", "sessions", "outbox"])
      expect(
        t.store.db.prepare(`SELECT count(*) n FROM ${table}`).get(),
      ).toEqual({ n: 0 });
  } finally {
    await t.close();
  }
});

it("bounds public startup reads independently while preserving password, auth-start and other API limits", async () => {
  const t = await fixture();
  const remoteAddress = "198.51.100.71",
    origin = "http://localhost:3000";
  try {
    for (let i = 0; i < 1200; i++)
      expect(
        (
          await t.app.inject({
            url: `/api/login-test?request=${i}`,
            remoteAddress,
          })
        ).statusCode,
      ).toBe(200);
    expect(
      (await t.app.inject({ url: "/api/session", remoteAddress })).statusCode,
    ).toBe(429);
    // Bootstrap exhaustion cannot prevent the first credential attempt; five
    // incorrect instructor passwords still exhaust the unchanged dedicated cap.
    for (let i = 0; i < 6; i++)
      expect(
        (
          await t.app.inject({
            method: "POST",
            url: "/api/admin/login",
            remoteAddress,
            headers: { origin },
            payload: { username: "synthetic", password: "incorrect" },
          })
        ).statusCode,
      ).toBe(i < 5 ? 401 : 429);
    for (let i = 0; i < 301; i++)
      expect(
        (
          await t.app.inject({
            method: "POST",
            url: "/api/auth/start",
            remoteAddress,
            headers: { origin },
            payload: {},
          })
        ).statusCode,
      ).toBe(i < 300 ? 200 : 429);
    for (let i = 0; i < 181; i++)
      expect(
        (
          await t.app.inject({
            url: "/api/admin/exams",
            remoteAddress,
            headers: { origin },
            payload: {},
          })
        ).statusCode,
      ).toBe(i < 180 ? 401 : 429);
    expect(t.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 0 },
    );
    expect(t.store.db.prepare("SELECT count(*) n FROM sessions").get()).toEqual(
      { n: 0 },
    );
  } finally {
    await t.close();
  }
});

it("keeps authenticated requests in the existing per-actor budget", async () => {
  const t = await fixture();
  try {
    const session = t.store.session("admin", "synthetic", null);
    for (let i = 0; i < 181; i++)
      expect(
        (
          await t.app.inject({
            url: "/api/login-test",
            remoteAddress: "198.51.100.72",
            headers: { cookie: `session=${session.token}` },
          })
        ).statusCode,
      ).toBe(i < 180 ? 200 : 429);
  } finally {
    await t.close();
  }
});
