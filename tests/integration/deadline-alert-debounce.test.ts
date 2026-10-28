import { expect, it, vi } from "vitest";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../../apps/server/src/app.js";
import { smtpFixture } from "../fixtures/smtp.js";

const grace = 120000;
const quiet = {
  logStream: new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  }),
};
async function fixture() {
  const data = mkdtempSync(tmpdir() + "/deadline-alert-");
  const keys = () =>
    generateKeyPairSync("ed25519", {
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
  const native = keys(),
    gateway = keys();
  writeFileSync(data + "/gateway.key", gateway.privateKey, { mode: 0o600 });
  writeFileSync(data + "/agent.pub", native.publicKey);
  const smtp = await smtpFixture(data + "/smtp.sock");
  const config = {
    mode: "development" as const,
    origin: "http://localhost:3000",
    data,
    port: 3000,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: data + "/gateway.key",
      callbackPublicKey: data + "/agent.pub",
    },
    smtp: {
      socket: data + "/smtp.sock",
      from: "exam@example.edu",
      to: ["teacher@example.edu"],
    },
  };
  let running = await createApp(config, quiet);
  let sequence = 0;
  const id = randomUUID(),
    at = Date.now(),
    deadline = at - 1000;
  running.store.db
    .prepare("INSERT INTO exams VALUES('timing-synthetic','{}')")
    .run();
  running.store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,generation,access_state) VALUES(?,'timing-synthetic','timingq',1001,'FINALIZING','{}',?,?,?,0,'HELD')",
    )
    .run(id, deadline - 60000, deadline, deadline);
  const remote = {
    id,
    exam: "timing-synthetic",
    username: "timingq",
    uid: 1001,
    state: "FINALIZING",
    start: deadline - 60000,
    deadline,
    original_deadline: deadline,
    clock_revision: 0,
    generation: 0,
    timing_pending_since: deadline,
  };
  async function send(url: string, value: object) {
    const payload = Buffer.from(JSON.stringify(value));
    return running.app.inject({
      method: "POST",
      url,
      headers: {
        "content-type": "application/vnd.ssh-exam-event",
        "x-exam-signature": sign(null, payload, native.privateKey).toString(
          "base64",
        ),
      },
      payload,
    });
  }
  return {
    id,
    at,
    remote,
    smtp,
    get app() {
      return running.app;
    },
    get store() {
      return running.store;
    },
    timing: () =>
      send("/api/agent/timing", {
        agent: "class",
        nonce: randomUUID().replaceAll("-", "").repeat(2),
        at: Date.now(),
        attempt: remote,
      }),
    event: (attempt: object) =>
      send("/api/agent/events", {
        agent: "class",
        sequence: ++sequence,
        at: Date.now(),
        attempt,
      }),
    restart: async () => {
      await running.app.close();
      running = await createApp(config, quiet);
    },
    close: async () => {
      await running.app.close();
      await smtp.close();
      rmSync(data, { recursive: true });
    },
  };
}

it("signed healthy deadline verification cancels its pending notice before real SMTP delivery", async () => {
  const f = await fixture();
  try {
    const decision = await f.timing();
    expect(decision.statusCode).toBe(200);
    expect(
      JSON.parse(Buffer.from(decision.json().payload, "base64").toString())
        .collect,
    ).toBe(true);
    const notice = f.store.db
      .prepare("SELECT id,status,next FROM outbox")
      .get() as any;
    expect(notice).toBeDefined();
    expect(notice.status).toBe("pending");
    expect(notice.next).toBeGreaterThanOrEqual(f.at + grace);
    expect(f.store.attempt(f.id)).toMatchObject({
      state: "FINALIZING",
      protected: 0,
      access_state: "HELD",
      deadline: f.remote.deadline,
    });
    // The actual five-second SMTP dispatcher runs while verification settles.
    await delay(5500);
    expect(f.smtp.messages).toHaveLength(0);
    const clear = await f.event({ ...f.remote, timing_pending_since: 0 });
    expect(clear.statusCode).toBe(200);
    expect(
      f.store.db.prepare("SELECT status FROM outbox WHERE id=?").get(notice.id),
    ).toEqual({ status: "cancelled" });
    expect(
      f.store.db.prepare("SELECT count(*) n FROM incidents").get(),
    ).toEqual({ n: 0 });
    // Even a later SMTP pass cannot resurrect the settled original notice.
    f.store.db
      .prepare("UPDATE outbox SET next=? WHERE id=?")
      .run(Date.now() - 1, notice.id);
    await delay(5500);
    expect(f.smtp.messages).toHaveLength(0);
  } finally {
    await f.close();
  }
}, 20000);

it("persistent timing verification still emails once after a durable non-sliding grace and restart", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const f = await fixture();
  try {
    expect((await f.event(f.remote)).statusCode).toBe(200);
    const first = f.store.db
      .prepare("SELECT id,status,next FROM outbox")
      .get() as any;
    expect(first.next).toBeGreaterThanOrEqual(f.at + grace);
    vi.setSystemTime(f.at + 30000);
    expect((await f.event(f.remote)).statusCode).toBe(200);
    await f.restart();
    expect((await f.event(f.remote)).statusCode).toBe(200);
    expect(
      f.store.db.prepare("SELECT id,status,next FROM outbox").get(),
    ).toEqual(first);
    vi.setSystemTime(first.next + 1);
    const until = performance.now() + 8000;
    while (
      (f.smtp.messages.length === 0 ||
        (
          f.store.db
            .prepare("SELECT status FROM outbox WHERE id=?")
            .get(first.id) as any
        ).status !== "sent") &&
      performance.now() < until
    )
      await delay(30);
    expect(f.smtp.messages).toHaveLength(1);
    expect(f.smtp.messages[0]).toContain(
      "Collection timing verification delayed",
    );
    expect(f.smtp.messages[0]).toContain("Automatic verification continues");
    expect(f.smtp.messages[0]).toContain("not evidence of a student violation");
    expect(f.store.db.prepare("SELECT id,status FROM outbox").get()).toEqual({
      id: first.id,
      status: "sent",
    });
    expect((await f.event(f.remote)).statusCode).toBe(200);
    expect(f.store.db.prepare("SELECT count(*) n FROM outbox").get()).toEqual({
      n: 1,
    });
    expect(
      f.store.db.prepare("SELECT count(*) n FROM incidents").get(),
    ).toEqual({ n: 0 });
  } finally {
    await f.close();
    vi.useRealTimers();
  }
}, 15000);

it("a delayed signed timing request preserves an already secured completed attempt and creates no recovery alert", async () => {
  const f = await fixture();
  try {
    const checksum = "a".repeat(64),
      ended = f.remote.deadline;
    f.store.db
      .prepare(
        "UPDATE attempts SET state='COMPLETED',protected=1,checksum=?,ended=?,access_state='RELEASED',policy_state='NORMAL' WHERE id=?",
      )
      .run(checksum, ended, f.id);
    expect((await f.timing()).statusCode).toBe(200);
    expect(f.store.attempt(f.id)).toMatchObject({
      state: "COMPLETED",
      protected: 1,
      checksum,
      ended,
      deadline: f.remote.deadline,
      original_deadline: f.remote.deadline,
      access_state: "RELEASED",
      policy_state: "NORMAL",
    });
    expect(f.store.db.prepare("SELECT count(*) n FROM outbox").get()).toEqual({
      n: 0,
    });
  } finally {
    await f.close();
  }
});
