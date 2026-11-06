import { expect, it } from "vitest";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";

it("delivers authorized time increases immediately over signed native HTTP without student SSH", async () => {
  const dir = mkdtempSync(tmpdir() + "/clock-dispatch-");
  const keys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  writeFileSync(dir + "/agent.pub", keys.publicKey);
  writeFileSync(dir + "/gateway.key", keys.privateKey, { mode: 0o600 });
  const current = await createApp({
    mode: "development",
    origin: "http://localhost:3000",
    data: dir,
    port: 0,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
    agent: {
      id: "class",
      signingKey: dir + "/gateway.key",
      callbackPublicKey: dir + "/agent.pub",
    },
  } as any);
  try {
    const id = randomUUID(),
      reset = randomUUID(),
      at = Date.now();
    current.store.db
      .prepare("INSERT INTO exams VALUES('synthetic','{}')")
      .run();
    current.store.db
      .prepare(
        `INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,access_state)
      VALUES(?,'synthetic','alice',1001,'LOCKED','{}',?,?,?,'HELD')`,
      )
      .run(id, at - 60000, at + 300000, at + 300000);
    const body = {
      id,
      reset_id: reset,
      actor: "instructor",
      requested_at: at,
      remaining_seconds: 0,
      extend_seconds: 1800,
      deadline: at + 300000,
      clock_revision: 0,
    };
    current.store.db
      .prepare(
        "INSERT INTO clock_reset_requests(id,attempt,body) VALUES(?,?,?)",
      )
      .run(reset, id, JSON.stringify(body));
    const before = current.store.attempt(id);
    const post = async (patch = {}, authenticated = true) => {
      const request = {
        agent: "class",
        nonce: randomBytes(32).toString("hex"),
        at: Date.now(),
        after: "",
        ...patch,
      };
      const payload = Buffer.from(JSON.stringify(request));
      const response = await current.app.inject({
        method: "POST",
        url: "/api/agent/clock-changes",
        payload,
        headers: {
          "content-type": "application/vnd.ssh-exam-event",
          ...(authenticated
            ? {
                "x-exam-signature": sign(
                  null,
                  payload,
                  keys.privateKey,
                ).toString("base64"),
              }
            : {}),
        },
      });
      return { response, request };
    };
    const { response, request } = await post();
    expect(response.statusCode).toBe(200);
    const envelope = response.json(),
      signed = Buffer.from(envelope.payload, "base64");
    expect(
      verify(
        null,
        signed,
        keys.publicKey,
        Buffer.from(envelope.signature, "base64"),
      ),
    ).toBe(true);
    expect(JSON.parse(signed.toString())).toMatchObject({
      type: "clock-changes/v1",
      audience: "class",
      nonce: request.nonce,
      requests: [body],
      after: "",
    });
    // Reading a queued change cannot consume it or claim native confirmation.
    expect(current.store.attempt(id)).toEqual(before);
    expect(
      current.store.db
        .prepare("SELECT status FROM clock_reset_requests WHERE id=?")
        .get(reset),
    ).toEqual({ status: "pending" });
    expect((await post({}, false)).response.statusCode).not.toBe(200);
    expect((await post({ agent: "other" })).response.statusCode).not.toBe(200);
    expect(
      (await post({ at: Date.now() - 61000 })).response.statusCode,
    ).not.toBe(200);
    expect(
      (await post({ extra: "reset-any-clock" })).response.statusCode,
    ).not.toBe(200);
    const history = [
      {
        id: reset,
        actor: body.actor,
        requested_at: body.requested_at,
        applied_at: Date.now(),
        previous_deadline: body.deadline,
        deadline: body.deadline + 1800000,
        remaining_seconds: 0,
        extend_seconds: 1800,
        revision: 1,
      },
    ];
    const native = {
      id,
      exam: "synthetic",
      username: "alice",
      uid: 1001,
      state: "LOCKED",
      start: before.start,
      deadline: history[0].deadline,
      original_deadline: before.original_deadline,
      clock_revision: 1,
      clock_resets: history,
      access_state: "HELD",
    };
    const report = async (sequence: number, pending: boolean) => {
      const payload = Buffer.from(
        JSON.stringify({
          agent: "class",
          sequence,
          at: Date.now(),
          attempt: { ...native, clock_handover_pending: pending },
        }),
      );
      return current.app.inject({
        method: "POST",
        url: "/api/agent/events",
        payload,
        headers: {
          "content-type": "application/vnd.ssh-exam-event",
          "x-exam-signature": sign(null, payload, keys.privateKey).toString(
            "base64",
          ),
        },
      });
    };
    // Durable clock storage is not confirmation that live panes switched.
    const saved = await report(1, true);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(
      current.store.db
        .prepare("SELECT status FROM clock_reset_requests WHERE id=?")
        .get(reset),
    ).toEqual({ status: "pending" });
    const retry = (await post()).response.json();
    expect(
      JSON.parse(Buffer.from(retry.payload, "base64").toString()).requests,
    ).toEqual([body]);
    const applied = await report(2, false);
    expect(applied.statusCode, applied.body).toBe(200);
    expect(
      current.store.db
        .prepare("SELECT status FROM clock_reset_requests WHERE id=?")
        .get(reset),
    ).toEqual({ status: "applied" });
    expect(current.store.attempt(id)).toMatchObject({
      start: before.start,
      original_deadline: before.original_deadline,
      deadline: history[0].deadline,
      clock_revision: 1,
      access_state: "HELD",
    });
    expect((await post()).response.json().payload).toBeTruthy();
    const empty = (await post()).response.json();
    expect(
      JSON.parse(Buffer.from(empty.payload, "base64").toString()).requests,
    ).toEqual([]);

    // More than one page of pending changes must remain reachable even if an
    // earlier student's change cannot be applied. Reading still consumes none.
    const queued = new Set<string>();
    current.store.db.transaction(() => {
      for (let n = 0; n < 101; n++) {
        const attempt = randomUUID(),
          change = randomUUID();
        queued.add(change);
        current.store.db
          .prepare(
            `INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,access_state)
          VALUES(?,'synthetic',?,?,'LOCKED','{}',?,?,?,'HELD')`,
          )
          .run(
            attempt,
            `synthetic${n}`,
            1002 + n,
            at - 60000,
            at + 300000,
            at + 300000,
          );
        current.store.db
          .prepare(
            "INSERT INTO clock_reset_requests(id,attempt,body) VALUES(?,?,?)",
          )
          .run(
            change,
            attempt,
            JSON.stringify({ ...body, id: attempt, reset_id: change }),
          );
      }
    })();
    const decode = (r: any) =>
      JSON.parse(Buffer.from(r.json().payload, "base64").toString());
    const firstPage = decode((await post()).response);
    expect(firstPage.requests).toHaveLength(100);
    expect(firstPage.after).toBe(firstPage.requests[99].reset_id);
    const lastPage = decode((await post({ after: firstPage.after })).response);
    expect(lastPage.requests).toHaveLength(1);
    expect(lastPage.after).toBe("");
    expect(
      new Set(
        [...firstPage.requests, ...lastPage.requests].map(
          (r: any) => r.reset_id,
        ),
      ),
    ).toEqual(queued);
  } finally {
    await current.app.close();
    current.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
