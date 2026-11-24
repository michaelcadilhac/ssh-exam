import { expect, it, vi } from "vitest";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../../apps/server/src/app.js";
import { smtpFixture } from "../fixtures/smtp.js";

async function fixture(retained = true) {
  const data = mkdtempSync(tmpdir() + "/native-hold-alert-"),
    at = Date.now(),
    id = randomUUID();
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
    port: 0,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
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
  const quiet = {
    logStream: new Writable({
      write(_c, _e, done) {
        done();
      },
    }),
  };
  let running = await createApp(config, quiet),
    sequence = 0;
  const owner = {
    attempt: id,
    exam: "notice",
    username: "noticeq",
    uid: 10001,
    transport_hash: "a".repeat(64),
    boot: randomUUID(),
    page_epoch: "b".repeat(64),
    input_epoch: "c".repeat(64),
    generation: 0,
    clock_revision: 0,
  };
  running.store.db.prepare("INSERT INTO exams VALUES('notice','{}')").run();
  running.store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,last_contact,page_hash,registered_owner,monitoring_mode,access_state) VALUES(?,'notice','noticeq',10001,'ACTIVE','{}',?,?,?,?,?,?,?,'HELD')",
    )
    .run(
      id,
      at - 1000,
      at + 3600000,
      at + 3600000,
      at,
      owner.page_epoch,
      retained ? JSON.stringify(owner) : null,
      retained ? "v1" : "legacy",
    );
  const remote = {
    id,
    exam: "notice",
    username: "noticeq",
    uid: 10001,
    state: "LOCKED",
    start: at - 1000,
    deadline: at + 3600000,
    original_deadline: at + 3600000,
    generation: 1,
    clock_revision: 0,
    reason:
      "Monitoring verification unavailable; technical safety hold, not a student violation",
    access_state: "HELD",
    policy_state: "HELD",
    ...(retained
      ? {
          monitoring_mode: "v1",
          browser_ssh: true,
          terminal_supervised: true,
          boot: owner.boot,
          registered_owner: owner,
          ssh_exited_owner: owner,
          retained_hold: "held",
          monitoring_hold_kind: "technical",
        }
      : {}),
  };
  const send = async (value: object = remote) => {
    const payload = Buffer.from(
      JSON.stringify({
        agent: "class",
        sequence: ++sequence,
        at: Date.now(),
        attempt: value,
      }),
    );
    return running.app.inject({
      method: "POST",
      url: "/api/agent/events",
      headers: {
        "content-type": "application/vnd.ssh-exam-event",
        "x-exam-signature": sign(null, payload, native.privateKey).toString(
          "base64",
        ),
      },
      payload,
    });
  };
  return {
    id,
    at,
    remote,
    smtp,
    send,
    get running() {
      return running;
    },
    restart: async () => {
      await running.app.close();
      running = await createApp(config, quiet);
    },
    close: async () => {
      await running.app.close();
      await smtp.close();
      rmSync(data, { recursive: true, force: true });
    },
  };
}
async function waitFor(check: () => boolean) {
  // Dispatcher cadence is five seconds; the refusal oracle is the durable
  // status, with independent headroom for SMTP completion after that tick.
  const until = performance.now() + 8000;
  while (!check() && performance.now() < until) await delay(25);
  expect(check()).toBe(true);
}

it.each([false, true])(
  "signed native hold sends one contextual email, despite callback replay/restart and later review messages (retained=%s)",
  async (retained) => {
    const f = await fixture(retained);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const original = f.running.store.attempt(f.id);
      const first = await f.send();
      expect(first.statusCode, first.body).toBe(200);
      const rows = () =>
        f.running.store.db
          .prepare("SELECT id,status,next FROM outbox")
          .all() as { id: string; status: string; next: number }[];
      expect(rows()).toHaveLength(1);
      expect(rows()[0].next).toBeGreaterThan(Date.now());
      for (let n = 0; n < 3; n++) expect((await f.send()).statusCode).toBe(200);
      expect(rows()).toHaveLength(1);
      await f.restart();
      expect((await f.send()).statusCode).toBe(200);
      expect(rows()).toHaveLength(1);
      vi.setSystemTime(Date.now() + 15001);
      await waitFor(() => rows()[0].status === "sent");
      expect(f.smtp.messages).toHaveLength(1);
      expect(f.smtp.messages[0]).toContain("Student: noticeq");
      expect(f.smtp.messages[0].replace(/=\r\n/g, "")).toContain(
        "technical safety hold, not a student violation",
      );
      expect(f.smtp.messages[0]).toContain(
        `Message-ID: <${rows()[0].id}@ssh-exam.local>`,
      );
      const session = f.running.store.session("student", "noticeq", "notice");
      const review = await f.running.app.inject({
        method: "POST",
        url: `/api/student/attempts/${f.id}/review-request`,
        headers: {
          origin: "http://localhost:3000",
          cookie: `session=${session.token}`,
          "x-csrf-token": session.csrf,
        },
        payload: { message: "Please help restore the connection" },
      });
      expect(review.statusCode, review.body).toBe(200);
      expect(rows()).toHaveLength(1);
      expect(f.running.store.attempt(f.id)).toMatchObject({
        state: "LOCKED",
        start: original.start,
        deadline: original.deadline,
        original_deadline: original.original_deadline,
        access_state: "HELD",
      });
    } finally {
      vi.useRealTimers();
      await f.close();
    }
  },
);

it("successful continuation cancels an unsent native-hold notice; another generation gets a new notice", async () => {
  const f = await fixture(false);
  try {
    expect((await f.send()).statusCode).toBe(200);
    const { store, life } = f.running;
    expect(store.db.prepare("SELECT status FROM outbox").get()).toEqual({
      status: "pending",
    });
    // Native continuation acceptance is the seam here. Its real coordinator
    // cancellation entry is exercised; SSH/native approval itself is unchanged.
    store.db
      .prepare("INSERT INTO continuations VALUES(?,?,?,0)")
      .run(f.id, 1, Date.now() + 60000);
    life.confirmContinuation(f.id, 1);
    expect(store.db.prepare("SELECT status FROM outbox").get()).toEqual({
      status: "cancelled",
    });
    expect((await f.send()).statusCode).toBe(200); // Retired same-generation hold.
    expect(store.attempt(f.id).state).toBe("ACTIVE");
    expect(store.db.prepare("SELECT COUNT(*) n FROM outbox").get()).toEqual({
      n: 1,
    });
    expect((await f.send({ ...f.remote, generation: 2 })).statusCode).toBe(200);
    expect(
      store.db.prepare("SELECT status FROM outbox ORDER BY rowid").all(),
    ).toEqual([{ status: "cancelled" }, { status: "pending" }]);
    expect(f.smtp.messages).toHaveLength(0);
  } finally {
    await f.close();
  }
});

it("native/gateway overlap preserves the original single email and explicit notification suppression", async () => {
  for (const notify of [true, false]) {
    const f = await fixture(false);
    try {
      vi.spyOn(f.running.life.agent, "call").mockResolvedValue({
        generation: 1,
      });
      await f.running.life.lock(f.id, "Screen sharing interrupted", { notify });
      expect((await f.send()).statusCode).toBe(200);
      expect(
        f.running.store.db.prepare("SELECT subject FROM outbox").all(),
      ).toHaveLength(notify ? 1 : 0);
      expect(f.running.store.attempt(f.id).reason).toBe(
        "Screen sharing interrupted",
      );
    } finally {
      vi.restoreAllMocks();
      await f.close();
    }
  }
});

it("failed notification persistence cannot acknowledge a native hold without its incident/outbox; retry repairs atomically", async () => {
  const f = await fixture();
  try {
    const { store } = f.running;
    store.db.exec(
      "CREATE TEMP TRIGGER fail_notice BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'synthetic outbox refusal'); END;",
    );
    const failed = await f.send();
    expect(failed.statusCode, failed.body).toBeGreaterThanOrEqual(400);
    expect(store.attempt(f.id).state).toBe("ACTIVE");
    expect(store.db.prepare("SELECT COUNT(*) n FROM incidents").get()).toEqual({
      n: 0,
    });
    expect(
      store.db.prepare("SELECT COUNT(*) n FROM alert_episodes").get(),
    ).toEqual({ n: 0 });
    store.db.exec("DROP TRIGGER fail_notice");
    expect((await f.send()).statusCode).toBe(200);
    expect(store.attempt(f.id).state).toBe("LOCKED");
    expect(store.db.prepare("SELECT COUNT(*) n FROM outbox").get()).toEqual({
      n: 1,
    });
  } finally {
    await f.close();
  }
});
