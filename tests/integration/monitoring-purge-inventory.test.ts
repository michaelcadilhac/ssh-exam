import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";

it("exposes bounded no-store purge metadata to administrators, including retired attempts, without resetting jobs", async () => {
  const dir = mkdtempSync(tmpdir() + "/purge-inventory-http-");
  const { app, store } = await createApp({
    mode: "development",
    origin: "http://127.0.0.1",
    data: dir,
    port: 0,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  });
  try {
    store.db.prepare("INSERT INTO tombstones VALUES('retired',0)").run();
    store.db
      .prepare(
        "INSERT INTO monitoring_purges(attempt,status,next,updated,error) VALUES('retired','retry',?,1,'permission')",
      )
      .run(Date.now() + 3600000);
    const before = store.db.prepare("SELECT * FROM monitoring_purges").all();
    const admin = store.session("admin", "teacher", null),
      student = store.session("student", "student", null);
    const headers = { cookie: `session=${admin.token}` };
    for (const path of [
      "/api/admin/monitoring/purges",
      "/api/admin/monitoring/purges/retired",
    ]) {
      for (const cookie of [undefined, `session=${student.token}`])
        expect(
          (await app.inject({ url: path, headers: cookie ? { cookie } : {} }))
            .statusCode,
        ).toBe(401);
      const response = await app.inject({ url: path, headers });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toContain(dir);
    }
    expect(
      (
        await app.inject({
          url: "/api/admin/monitoring/purges/retired",
          headers,
        })
      ).json(),
    ).toMatchObject({
      id: "retired",
      deleted: 0,
      attempt: null,
      job: { status: "retry", error: "permission" },
    });
    for (const query of [
      "limit=101",
      "limit=0",
      "limit=01",
      "limit=-1",
      "limit=1.5",
      "status=not-verified",
      "after=../private",
      "extra=1",
    ])
      expect(
        (
          await app.inject({
            url: "/api/admin/monitoring/purges?" + query,
            headers,
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await app.inject({
          url: "/api/admin/monitoring/purges/missing",
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: "/api/admin/monitoring/purges?status=retry&limit=1",
          headers,
        })
      ).json().entries[0].id,
    ).toBe("retired");
    expect(store.db.prepare("SELECT * FROM monitoring_purges").all()).toEqual(
      before,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
