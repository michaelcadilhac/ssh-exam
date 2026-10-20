import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { createApp } from "../../apps/server/src/app.js";

it("audits every accepted review request but emails distinct messages only once in an interruption, including after restart", async () => {
  const data = mkdtempSync(tmpdir() + "/review-alerts-");
  const config: any = {
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
  };
  const options = {
    logStream: new Writable({
      write(_c, _e, cb) {
        cb();
      },
    }),
  };
  let fixture = await createApp(config, options);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const store = fixture.store;
    store.db.exec(
      "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,generation) VALUES('a','e','alice',1001,'LOCKED','{}',1); INSERT INTO incidents(id,attempt,generation,opened,events) VALUES('incident','a',1,1,'[]');",
    );
    const s = store.session("student", "alice", "e");
    const headers = {
      cookie: `session=${s.token}`,
      origin: config.origin,
      "x-csrf-token": s.csrf,
    };
    const request = (message: string) =>
      fixture.app.inject({
        method: "POST",
        url: "/api/student/attempts/a/review-request",
        headers,
        payload: { message },
      });
    expect((await request("Please help")).statusCode).toBe(200);
    expect((await request(" Please help ")).statusCode).toBe(200);
    expect(store.db.prepare("SELECT count(*) AS n FROM outbox").get()).toEqual({
      n: 1,
    });
    store.db.prepare("UPDATE outbox SET status='sent'").run();
    await fixture.app.close();
    fixture = await createApp(config, options);
    expect((await request("Please help")).statusCode).toBe(200);
    expect(
      (await request("A different message\nStudent: forged")).statusCode,
    ).toBe(200);
    expect(
      fixture.store.db.prepare("SELECT count(*) AS n FROM outbox").get(),
    ).toEqual({ n: 2 });
    expect(
      fixture.store.db
        .prepare(
          "SELECT count(*) AS n FROM audit WHERE action='review-request'",
        )
        .get(),
    ).toEqual({ n: 4 });
    vi.setSystemTime(Date.now() + 61000);
    fixture.store.db
      .prepare("UPDATE attempts SET generation=2 WHERE id='a'")
      .run();
    fixture.store.db.exec(
      "INSERT INTO incidents(id,attempt,generation,opened,events) VALUES('incident2','a',2,2,'[]')",
    );
    expect((await request("Please help")).statusCode).toBe(200);
    expect(
      fixture.store.db.prepare("SELECT count(*) AS n FROM outbox").get(),
    ).toEqual({ n: 3 });
    const messages = fixture.store.db
      .prepare("SELECT body FROM outbox")
      .all() as any[];
    expect(messages[1].body).not.toContain("\nStudent: forged");
    expect(fixture.store.attempt("a").state).toBe("LOCKED");
  } finally {
    vi.useRealTimers();
    await fixture.app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
