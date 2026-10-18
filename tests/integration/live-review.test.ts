import { it, expect } from "vitest";
import { createApp } from "../../apps/server/src/app.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
it("serves incremental recordings only to instructors and validates cursor and recording identity", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-live-review-");
  const { app, store } = await createApp({
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
  });
  try {
    const id = "11111111-1111-4111-8111-111111111111",
      pane = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    store.db.prepare("INSERT INTO exams VALUES('exam','{}')").run();
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES(?,'exam','alice',1001,'ACTIVE','{}')",
      )
      .run(id);
    const m = new Monitoring(store);
    m.record(id, pane, { event: "open" });
    const admin = store.session("admin", "instructor", null),
      student = store.session("student", "alice", "exam");
    const headers = { cookie: `session=${admin.token}` };
    const url = `/api/admin/attempts/${id}/recordings/${pane}`;
    for (const cookie of [undefined, `session=${student.token}`])
      expect(
        (
          await app.inject({
            url: url + "?offset=0",
            headers: cookie ? { cookie } : {},
          })
        ).statusCode,
      ).toBe(401);
    const initial = await app.inject({ url: url + "?offset=0", headers });
    expect(initial.statusCode).toBe(200);
    expect(initial.headers["cache-control"]).toBe("no-store");
    const first = initial.json();
    expect(JSON.parse(first.text).event).toBe("open");
    m.record(id, pane, { event: "output", data: "aGVsbG8=" });
    const next = await app.inject({
      url: url + `?offset=${first.nextOffset}`,
      headers,
    });
    expect(next.statusCode).toBe(200);
    expect(JSON.parse(next.json().text).event).toBe("output");
    expect((await app.inject({ url, headers })).body).toBe(
      first.text + next.json().text,
    );
    for (const offset of [
      "-1",
      "0.5",
      "abc",
      "01",
      "9007199254740992",
      "999999",
      "1",
    ])
      expect(
        (await app.inject({ url: url + "?offset=" + offset, headers }))
          .statusCode,
      ).toBe(400);
    expect(
      (
        await app.inject({
          url:
            url.replace(id, "22222222-2222-4222-8222-222222222222") +
            "?offset=0",
          headers,
        })
      ).statusCode,
    ).toBe(400);
    m.delete(id, "instructor");
    expect(
      (await app.inject({ url: url + "?offset=0", headers })).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
