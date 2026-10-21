import { expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { createApp } from "../../apps/server/src/app.js";
import { Store } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";

it.skipIf(process.getuid?.() === 0)(
  "serves authenticated requests after startup purge permission failures and contains scheduled retention exceptions",
  async () => {
    const dir = mkdtempSync(tmpdir() + "/exam-retention-http-");
    const seed = new Store(dir),
      media = new Monitoring(seed);
    seed.db.exec("INSERT INTO exams VALUES('e','{}')");
    seed.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,ended) VALUES('old','e','old',1001,'COMPLETED','{}',?)",
      )
      .run(Date.now() - 61 * 86400000);
    media.record("old", "pane", { event: "open" });
    seed.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,last_contact,preflight_started_at) VALUES('healthy','e','healthy',1002,'PREPARING','{}',?,?)",
      )
      .run(Date.now(), Date.now());
    const before = seed.attempt("healthy");
    seed.close();
    chmodSync(`${dir}/monitoring/old`, 0o500);
    let logs = "",
      scheduled: (() => void) | undefined;
    const realInterval = globalThis.setInterval;
    const intervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(((
        handler: () => void,
        delay?: number,
        ...args: any[]
      ) => {
        if (delay === 3600000) scheduled = handler;
        return realInterval(handler, delay, ...args);
      }) as typeof setInterval);
    let running: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      running = await createApp(
        {
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
      intervalSpy.mockRestore();
      expect(
        running.store.db
          .prepare("SELECT attempt FROM tombstones WHERE attempt='old'")
          .get(),
      ).toEqual({ attempt: "old" });
      expect(existsSync(`${dir}/monitoring/old/pane.ndjson`)).toBe(true);
      expect(running.store.attempt("healthy")).toEqual(before);
      const session = running.store.session("student", "healthy", "e");
      const request = () =>
        running!.app.inject({
          method: "GET",
          url: "/api/session",
          headers: { cookie: `session=${session.token}` },
        });
      expect((await request()).json().username).toBe("healthy");
      expect(logs).toContain("monitoring-retention-incomplete");
      const cleanupSpy = vi
        .spyOn(Monitoring.prototype, "cleanup")
        .mockImplementationOnce(() => {
          throw Error("PRIVATE_DATABASE_EXCEPTION");
        });
      try {
        expect(scheduled).toBeTypeOf("function");
        expect(() => scheduled!()).not.toThrow();
      } finally {
        cleanupSpy.mockRestore();
      }
      expect((await request()).statusCode).toBe(200);
      expect(
        (
          await running.app.inject({ method: "GET", url: "/health/live" })
        ).json(),
      ).toEqual({ ok: true });
      expect(logs).toContain("monitoring-retention-unavailable");
      expect(logs).not.toContain("PRIVATE_DATABASE_EXCEPTION");
      expect(logs).not.toContain(dir);
    } finally {
      intervalSpy.mockRestore();
      await running?.app.close();
      if (existsSync(`${dir}/monitoring/old`))
        chmodSync(`${dir}/monitoring/old`, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
