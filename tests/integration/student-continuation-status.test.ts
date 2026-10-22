import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { createApp } from "../../apps/server/src/app.js";

it("serves scoped live approval/expiry/revocation metadata without native calls, permission changes or private history", async () => {
  const data = mkdtempSync(tmpdir() + "/student-approval-http-");
  const time = vi.spyOn(Date, "now").mockReturnValue(100000);
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
    const call = vi
      .spyOn(life.agent, "call")
      .mockImplementation(async (_op, body) => ({
        generation: body?.generation,
      }));
    store.db.exec(
      "INSERT INTO exams VALUES('e','{}'); INSERT INTO exams VALUES('other','{}')",
    );
    const id = randomUUID();
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,page_hash,access_state) VALUES(?,'e','alice',1001,'ACTIVE','{}',1,900000,900000,'PRIVATE-PAGE','HELD')",
      )
      .run(id);
    await life.lock(id, "PRIVATE-INTERRUPTION-REASON");
    const student = store.session("student", "alice", "e"),
      teacher = store.session("admin", "teacher", null);
    const cookie = { cookie: `session=${student.token}` };
    const read = async () => {
      const before = store.attempt(id),
        calls = call.mock.calls.length;
      const result = await app.inject({
        url: `/api/student/attempts/${id}/status`,
        headers: cookie,
      });
      expect(result.statusCode).toBe(200);
      const body = result.json();
      expect(body.continuation).toMatchObject({
        v: 1,
        attempt: id,
        generation: before.generation,
        revision: before.continuation_revision,
        observedAt: body.serverNow,
        execution: false,
      });
      expect(JSON.stringify(body.continuation)).not.toContain("PRIVATE");
      expect(store.attempt(id)).toEqual(before);
      expect(call.mock.calls.length).toBe(calls);
      return body;
    };
    expect((await read()).continuation.state).toBe("waiting");
    for (const session of [
      store.session("student", "bob", "e"),
      store.session("student", "alice", "other"),
    ])
      expect(
        (
          await app.inject({
            url: `/api/student/attempts/${id}/status`,
            headers: { cookie: `session=${session.token}` },
          })
        ).statusCode,
      ).toBe(403);
    const current = store.attempt(id);
    const approved = await app.inject({
      method: "POST",
      url: `/api/admin/attempts/${id}/authorize`,
      headers: {
        cookie: `session=${teacher.token}`,
        origin: "http://localhost:3000",
        "x-csrf-token": teacher.csrf,
      },
      payload: {
        generation: current.generation,
        revision: current.continuation_revision,
        requestID: randomUUID(),
        reason: "Reviewed synthetic current interruption",
      },
    });
    expect(approved.statusCode).toBe(200);
    expect((await read()).continuation).toMatchObject({
      state: "approved",
      expires: approved.json().expires,
    });
    expect(store.attempt(id)).toMatchObject({
      state: "LOCKED",
      deadline: 900000,
      original_deadline: 900000,
      access_state: "HELD",
    });
    time.mockReturnValue(approved.json().expires);
    expect((await read()).continuation.state).toBe("expired");
    time.mockReturnValue(500000);
    const expired = store.attempt(id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/admin/attempts/${id}/authorize`,
          headers: {
            cookie: `session=${teacher.token}`,
            origin: "http://localhost:3000",
            "x-csrf-token": teacher.csrf,
          },
          payload: {
            generation: expired.generation,
            revision: expired.continuation_revision,
            requestID: randomUUID(),
            reason: "Reviewed explicit replacement after expiry",
          },
        })
      ).statusCode,
    ).toBe(200);
    time.mockReturnValue(510000);
    await life.lock(id, "PRIVATE-NEW-REASON");
    expect((await read()).continuation.state).toBe("revoked");
  } finally {
    await app.close();
    store.close();
    time.mockRestore();
    rmSync(data, { recursive: true, force: true });
  }
});
