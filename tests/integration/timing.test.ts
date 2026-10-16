import { expect, it } from "vitest";
import { generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { createApp } from "../../apps/server/src/app.js";
it("authenticates timing checks, persists offline resets, binds decisions and exposes honest roster presence", async () => {
  const dir = mkdtempSync(tmpdir() + "/timing-http-");
  const keys = () =>
    generateKeyPairSync("ed25519", {
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
  const root = keys(),
    gateway = keys();
  writeFileSync(dir + "/gateway.key", gateway.privateKey);
  writeFileSync(dir + "/agent.pub", root.publicKey);
  const { app, store, life } = await createApp(
    {
      mode: "development",
      origin: "http://localhost:3000",
      data: dir,
      port: 3000,
      jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
      class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
      agent: {
        id: "class",
        signingKey: dir + "/gateway.key",
        callbackPublicKey: dir + "/agent.pub",
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
    store.db.prepare("INSERT INTO agent_snapshot VALUES(?,?,?)").run(
      "class",
      1,
      JSON.stringify({
        health: { ready: true, fixture: true },
        accounts: { alice: 1001 },
      }),
    );
    const id = randomUUID(),
      start = Date.now() - 60000,
      deadline = Date.now() + 60000;
    store.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
    store.db
      .prepare("INSERT INTO enrollments VALUES('e','alice',0,NULL,NULL,1001)")
      .run();
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,last_contact) VALUES(?,'e','alice',1001,'ACTIVE','{}',?,?,?,?)",
      )
      .run(id, start, deadline, deadline, Date.now());
    const admin = store.session("admin", "instructor", null),
      student = store.session("student", "alice", "e");
    const body = { minutes: 90, revision: 0, requestID: randomUUID() };
    const headers = {
      cookie: `session=${admin.token}`,
      origin: "http://localhost:3000",
      "x-csrf-token": admin.csrf,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/admin/attempts/${id}/reset-clock`,
          headers: { ...headers, "x-csrf-token": "bad" },
          payload: body,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/admin/attempts/${id}/reset-clock`,
          headers: {
            cookie: `session=${student.token}`,
            origin: headers.origin,
            "x-csrf-token": student.csrf,
          },
          payload: body,
        })
      ).statusCode,
    ).toBe(401);
    const reset = await app.inject({
      method: "POST",
      url: `/api/admin/attempts/${id}/reset-clock`,
      headers,
      payload: body,
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().confirmed).toBe(false);
    const request = reset.json().pending;
    const roster = (
      await app.inject({ url: "/api/admin/exams/e/roster", headers })
    ).json();
    expect(roster[0].attempt).toMatchObject({
      id,
      working: false,
      connected: false,
      terminalCount: 0,
    });
    expect(roster[0].attempt.pendingClockReset.reset_id).toBe(body.requestID);
    const snapshot = {
      id,
      exam: "e",
      username: "alice",
      uid: 1001,
      state: "LOCKED",
      start,
      deadline,
      original_deadline: deadline,
      clock_revision: 0,
      generation: 1,
    };
    const payload = Buffer.from(
      JSON.stringify({
        agent: "class",
        nonce: "a".repeat(64),
        at: Date.now(),
        attempt: snapshot,
      }),
    );
    const send = (signature: string) =>
      app.inject({
        method: "POST",
        url: "/api/agent/timing",
        headers: {
          "content-type": "application/vnd.ssh-exam-event",
          "x-exam-signature": signature,
        },
        payload,
      });
    expect((await send(Buffer.alloc(64).toString("base64"))).statusCode).toBe(
      403,
    );
    const decision = await send(
      sign(null, payload, root.privateKey).toString("base64"),
    );
    expect(decision.statusCode).toBe(200);
    const frame = decision.json(),
      signed = Buffer.from(frame.payload, "base64");
    expect(
      verify(
        null,
        signed,
        gateway.publicKey,
        Buffer.from(frame.signature, "base64"),
      ),
    ).toBe(true);
    expect(JSON.parse(signed.toString())).toMatchObject({
      type: "deadline-timing",
      nonce: "a".repeat(64),
      id,
      collect: false,
      reset: request,
    });
    const newDeadline = request.requested_at + request.remaining_seconds * 1000;
    life.acceptRemote({
      ...snapshot,
      deadline: newDeadline,
      clock_revision: 1,
      clock_resets: [
        {
          id: request.reset_id,
          actor: request.actor,
          requested_at: request.requested_at,
          applied_at: Date.now(),
          previous_deadline: deadline,
          deadline: newDeadline,
          remaining_seconds: request.remaining_seconds,
          revision: 1,
        },
      ],
    });
    expect(store.attempt(id).deadline).toBe(newDeadline);
    expect(
      store.db
        .prepare("SELECT status FROM clock_reset_requests WHERE id=?")
        .get(body.requestID),
    ).toEqual({ status: "applied" });
    const expiredID = randomUUID(),
      past = Date.now() - 1000;
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline) VALUES(?,'e','bob',1002,'LOCKED','{}',?,?,?)",
      )
      .run(expiredID, past - 5400000, past, past);
    const expired = Buffer.from(
      JSON.stringify({
        agent: "class",
        nonce: "b".repeat(64),
        at: Date.now(),
        attempt: {
          id: expiredID,
          exam: "e",
          username: "bob",
          uid: 1002,
          state: "LOCKED",
          start: past - 5400000,
          deadline: past,
          original_deadline: past,
          timing_pending_since: past,
        },
      }),
    );
    const clear = await app.inject({
      method: "POST",
      url: "/api/agent/timing",
      headers: {
        "content-type": "application/vnd.ssh-exam-event",
        "x-exam-signature": sign(null, expired, root.privateKey).toString(
          "base64",
        ),
      },
      payload: expired,
    });
    expect(clear.statusCode).toBe(200);
    expect(
      JSON.parse(Buffer.from(clear.json().payload, "base64").toString())
        .collect,
    ).toBe(true);
    expect(store.attempt(expiredID)).toMatchObject({
      state: "FINALIZING",
      protected: 0,
      reason: "Collection pending: deadline timing verification unavailable",
    });
    expect(
      store.db
        .prepare(
          "SELECT subject FROM outbox WHERE subject='Collection timing requires recovery'",
        )
        .all(),
    ).toHaveLength(1);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
