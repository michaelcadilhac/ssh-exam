import { expect, it, vi } from "vitest";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { createApp } from "../../apps/server/src/app.js";
import { AgentCommandDisconnectedError } from "../../apps/server/src/agent.js";
import * as mail from "../../apps/server/src/mail.js";
import { PREFLIGHT_TIMEOUT_MS } from "../../packages/protocol/preflight.js";

it("logout logs the actual command failure, signs out and defers its contextual alert until local expiry confirmation is overdue", async () => {
  const data = mkdtempSync(tmpdir() + "/preflight-cleanup-");
  let logs = "";
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
        write(c, _e, cb) {
          logs += c.toString();
          cb();
        },
      }),
    },
  );
  try {
    const call = vi
      .spyOn(life.agent, "call")
      .mockRejectedValue(
        new AgentCommandDisconnectedError("SSH connection ended"),
      );
    store.db.prepare("INSERT INTO exams VALUES('test','{}')").run();
    const id = randomUUID();
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES(?,'test','alice',1001,'PREPARING','{}')",
      )
      .run(id);
    const student = store.session("student", "alice", "test");
    const result = await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: {
        cookie: `session=${student.token}`,
        origin: "http://localhost:3000",
        "x-csrf-token": student.csrf,
      },
      payload: {},
    });
    expect(result.statusCode).toBe(200);
    expect(result.headers["set-cookie"]).toContain("session=;");
    expect(store.attempt(id).state).toBe("PREPARING");
    expect(call).toHaveBeenCalledWith("cancel-attempt", {
      id,
      reason: "Signed out before starting",
    });
    const diagnostic = logs
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((line) => line.msg === "Preflight cleanup failed");
    expect(diagnostic).toMatchObject({
      attempt: id,
      username: "alice",
      exam: "test",
      stage: "cancel-attempt",
      cause: "ssh-disconnected",
      reason: "SSH connection ended",
      outcome: "cleanup-pending",
    });
    const email = store.db
      .prepare(
        "SELECT id,subject,body,next FROM outbox WHERE subject LIKE 'Preflight cleanup pending:%'",
      )
      .get() as any;
    expect(email.subject).toBe("Preflight cleanup pending: alice (test)");
    expect(email.body).toContain("Reason: SSH connection ended");
    expect(email.body).not.toContain("class agent unavailable");
    expect(email.next).toBeGreaterThan(Date.now() + 15 * 60 * 1000);
    expect(life.preparePreflightNotification(email.id)).toBe(false);
    expect(logs).not.toContain(student.token);
  } finally {
    await app.close();
    store.close();
    rmSync(data, { recursive: true, force: true });
  }
});

it.each([false, true])(
  "only a pinned signed callback cancels deferred mail, including an SMTP failure in flight (%s)",
  async (inFlight) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const data = mkdtempSync(tmpdir() + "/preflight-confirmation-");
    const keys = generateKeyPairSync("ed25519");
    writeFileSync(
      data + "/agent.pub",
      keys.publicKey.export({ type: "spki", format: "pem" }),
    );
    let rejectMail!: (error: Error) => void;
    const send = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectMail = reject;
        }),
    );
    const closed = vi.fn();
    const transport = vi
      .spyOn(mail, "mailTransport")
      .mockReturnValue({ sendMail: send, close: closed } as any);
    const { app, store, life } = await createApp({
      mode: "development",
      origin: "http://localhost:3000",
      data,
      port: 3000,
      jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
      class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
      agent: {
        id: "class",
        signingKey: "/missing",
        callbackPublicKey: data + "/agent.pub",
      },
      maintenance: false,
      smtp: {
        socket: data + "/unused.sock",
        from: "exam@example.edu",
        to: ["instructor@example.edu"],
      },
    });
    try {
      vi.spyOn(life.agent, "call").mockRejectedValue(
        new AgentCommandDisconnectedError("SSH connection ended"),
      );
      store.db.prepare("INSERT INTO exams VALUES('test','{}')").run();
      const id = randomUUID();
      store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,preflight_started_at,last_contact) VALUES(?,'test','alice',1001,'PREPARING','{}',?,?)",
        )
        .run(id, Date.now() - PREFLIGHT_TIMEOUT_MS, Date.now());
      await expect(life.cancelPreflight(id, "expired")).rejects.toThrow();
      const notice = store.db
        .prepare("SELECT id,next FROM outbox")
        .get() as any;
      const payload = Buffer.from(
        JSON.stringify({
          agent: "class",
          sequence: 1,
          at: Date.now(),
          attempt: {
            id,
            exam: "test",
            username: "alice",
            uid: 1001,
            state: "CANCELLED_BEFORE_START",
            start: 0,
            deadline: 0,
            original_deadline: 0,
            ended: Date.now(),
            policy_state: "NORMAL",
          },
        }),
      );
      const post = (signature: string) =>
        app.inject({
          method: "POST",
          url: "/api/agent/events",
          headers: {
            "content-type": "application/vnd.ssh-exam-event",
            "x-exam-signature": signature,
          },
          payload,
        });
      expect((await post(Buffer.alloc(64).toString("base64"))).statusCode).toBe(
        403,
      );
      expect(
        store.db.prepare("SELECT status FROM outbox WHERE id=?").get(notice.id),
      ).toEqual({ status: "pending" });
      if (inFlight) {
        vi.setSystemTime(notice.next);
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce(), {
          timeout: 7000,
        });
      }
      expect(
        (await post(sign(null, payload, keys.privateKey).toString("base64")))
          .statusCode,
      ).toBe(200);
      if (inFlight) {
        rejectMail(Error("synthetic SMTP failure"));
        await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
      } else expect(send).not.toHaveBeenCalled();
      expect(store.attempt(id).state).toBe("CANCELLED_BEFORE_START");
      expect(
        store.db
          .prepare("SELECT status,tries FROM outbox WHERE id=?")
          .get(notice.id),
      ).toEqual({ status: "cancelled", tries: 0 });
      expect(life.preparePreflightNotification(notice.id)).toBe(false);
    } finally {
      transport.mockRestore();
      await app.close();
      rmSync(data, { recursive: true, force: true });
      vi.useRealTimers();
    }
  },
  12000,
);
