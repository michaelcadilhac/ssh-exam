import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { createApp } from "../../apps/server/src/app.js";

it("reload locks only the owned active attempt, revokes the old page, preserves timing and existing continuation on retries", async () => {
  const data = mkdtempSync(tmpdir() + "/page-recovery-");
  const { app, store, life } = await createApp(
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
        write(_c, _e, cb) {
          cb();
        },
      }),
    },
  );
  try {
    const command = vi
      .spyOn(life.agent, "call")
      .mockResolvedValue({ generation: 1 });
    store.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
    const id = randomUUID(),
      start = Date.now() - 60000,
      deadline = start + 5400000;
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,page_hash,start,deadline,original_deadline,last_contact) VALUES(?,'e','alice',1001,'ACTIVE','{}','old-page',?,?,?,?)",
      )
      .run(id, start, deadline, deadline, Date.now());
    const student = store.session("student", "alice", "e"),
      other = store.session("student", "bob", "e");
    const headers = {
      cookie: `session=${student.token}`,
      origin: "http://localhost:3000",
      "x-csrf-token": student.csrf,
    };
    const url = `/api/student/attempts/${id}/recover-page`;
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { ...headers, "x-csrf-token": "wrong" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: {
            ...headers,
            cookie: `session=${other.token}`,
            "x-csrf-token": other.csrf,
          },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(store.attempt(id).state).toBe("ACTIVE");
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url, headers, payload: {} }),
      app.inject({ method: "POST", url, headers, payload: {} }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(store.attempt(id)).toMatchObject({
      state: "LOCKED",
      generation: 1,
      page_hash: null,
      start,
      deadline,
      original_deadline: deadline,
    });
    expect(command).toHaveBeenCalledExactlyOnceWith(
      "lock-attempt",
      expect.objectContaining({ id, generation: 1 }),
    );
    const expires = Date.now() + 300000;
    store.db
      .prepare("INSERT INTO continuations VALUES(?,?,?,0)")
      .run(id, 1, expires);
    expect(
      (await app.inject({ method: "POST", url, headers, payload: {} }))
        .statusCode,
    ).toBe(200);
    expect(store.attempt(id).generation).toBe(1);
    expect(
      store.db.prepare("SELECT * FROM continuations WHERE attempt=?").get(id),
    ).toMatchObject({ generation: 1, expires, consumed: 0 });
    for (const state of ["COMPLETED", "FINALIZING", "COLLECTION_FAILED"]) {
      store.db.prepare("UPDATE attempts SET state=? WHERE id=?").run(state, id);
      const result = await app.inject({
        method: "POST",
        url,
        headers,
        payload: {},
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().attempt.state).toBe(state);
      expect(store.attempt(id).deadline).toBe(deadline);
    }
    expect(command).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
    store.close();
    rmSync(data, { recursive: true, force: true });
  }
});
