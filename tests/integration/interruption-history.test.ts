import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { createApp } from "../../apps/server/src/app.js";
it("dashboard exposes only the selected exam's interruption approvals, and approval alone cannot finish the pause", async () => {
  const data = mkdtempSync(tmpdir() + "/interruption-api-");
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
    vi.spyOn(life.agent, "call").mockImplementation(async (_op, body) => ({
      generation: body?.generation,
    }));
    store.db
      .prepare("INSERT INTO exams VALUES(?,?)")
      .run("e", JSON.stringify({ id: "e" }));
    store.db
      .prepare("INSERT INTO exams VALUES(?,?)")
      .run("other", JSON.stringify({ id: "other" }));
    const id = randomUUID();
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,page_hash) VALUES(?,'e','alice',1001,'ACTIVE','{}',?,?,?,'page')",
      )
      .run(id, Date.now() - 60000, Date.now() + 600000, Date.now() + 600000);
    await life.lock(id, "Screen sharing ended");
    const admin = store.session("admin", "teacher", null),
      student = store.session("student", "alice", "e");
    const headers = {
      cookie: `session=${admin.token}`,
      origin: "http://localhost:3000",
      "x-csrf-token": admin.csrf,
    };
    const url = "/api/admin/exams/e/dashboard";
    expect(
      (
        await app.inject({
          url,
          headers: { cookie: `session=${student.token}` },
        })
      ).statusCode,
    ).toBe(401);
    let result = (await app.inject({ url, headers })).json();
    expect(result.students[0].attempts[0].interruptions).toHaveLength(1);
    const pause = result.students[0].attempts[0].interruptions[0];
    expect(pause.events[0].reason).toBe("Screen sharing ended");
    expect(pause.authorizations).toEqual([]);
    const approval = await app.inject({
      method: "POST",
      url: `/api/admin/attempts/${id}/authorize`,
      headers,
      payload: {},
    });
    expect(approval.statusCode).toBe(200);
    result = (await app.inject({ url: url + `?review=${id}`, headers })).json();
    const entry = result.reviewAttempt.interruptions[0];
    expect(entry.authorizations[0]).toMatchObject({
      actor: "teacher",
      automatic: false,
      expires: approval.json().expires,
    });
    expect(entry.ended).toBeNull();
    expect(entry.outcome).toBeNull();
    expect(store.attempt(id).state).toBe("LOCKED");
    const other = (
      await app.inject({ url: "/api/admin/exams/other/dashboard", headers })
    ).json();
    expect(other.students).toEqual([]);
    store.db
      .prepare("UPDATE attempts SET state='COMPLETED',ended=? WHERE id=?")
      .run(Date.now(), id);
    store.interruptions.end(store.attempt(id));
    new (await import("../../apps/server/src/monitoring.js")).Monitoring(
      store,
    ).delete(id, "teacher");
    result = (await app.inject({ url, headers })).json();
    expect(result.students[0].attempts[0]).toMatchObject({
      interruptions: [],
      interruptionHistoryDeleted: true,
    });
  } finally {
    await app.close();
    store.close();
    rmSync(data, { recursive: true, force: true });
  }
});
