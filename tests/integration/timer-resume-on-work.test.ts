import { expect, it, vi } from "vitest";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";

// Real admin/native HTTP, durable SQLite and restart. Native clock outcomes are
// signed synthetic producers; the real student Continue entry is also exercised
// in retained-continuation.test.ts, including both failed acknowledgement paths.
async function fixture() {
  const dir = mkdtempSync(tmpdir() + "/timer-auto-work-"),
    origin = "http://localhost:3000";
  const keys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  writeFileSync(dir + "/gateway.key", keys.privateKey, { mode: 0o600 });
  writeFileSync(dir + "/agent.pub", keys.publicKey);
  const config: any = {
    mode: "development",
    origin,
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
  };
  let f = await createApp(config),
    sequence = 0;
  const id = randomUUID(),
    start = Date.now() - 60000,
    deadline = Date.now() + 300000;
  const owner = {
    attempt: id,
    exam: "auto",
    username: "alice",
    uid: 1001,
    transport_hash: "a".repeat(64),
    boot: randomUUID(),
    page_epoch: "b".repeat(64),
    input_epoch: "c".repeat(64),
    generation: 0,
    clock_revision: 0,
  };
  f.store.db.prepare("INSERT INTO exams VALUES('auto','{}')").run();
  f.store.db
    .prepare(
      `INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,generation,monitoring_mode,registered_owner,retained_hold,access_state)
    VALUES(?,'auto','alice',1001,'LOCKED','{}',?,?,?,1,'v1',?,'held','HELD')`,
    )
    .run(id, start, deadline, deadline, JSON.stringify(owner));
  f.store.interruptions.pause(f.store.attempt(id), "Synthetic stop");
  const admin = f.store.session("admin", "teacher", null);
  const headers = {
    origin,
    cookie: `session=${admin.token}`,
    "x-csrf-token": admin.csrf,
  };
  const signed = async (url: string, body: any) => {
    const payload = Buffer.from(JSON.stringify(body));
    return f.app.inject({
      method: "POST",
      url,
      payload,
      headers: {
        "content-type": "application/vnd.ssh-exam-event",
        "x-exam-signature": sign(null, payload, keys.privateKey).toString(
          "base64",
        ),
      },
    });
  };
  await signed("/api/agent/events", {
    agent: "class",
    sequence: ++sequence,
    health: {
      ready: true,
      capabilities: [
        "clock-reset",
        "clock-extend",
        "deadline-timing-check",
        "timer-clock-controls-v1",
      ],
    },
  });
  let remote: any = {
    id,
    exam: "auto",
    username: "alice",
    uid: 1001,
    state: "LOCKED",
    generation: 1,
    start,
    deadline,
    original_deadline: deadline,
    clock_revision: 0,
    clock_resets: [],
    registered_owner: owner,
    boot: owner.boot,
    browser_ssh: true,
    terminal_supervised: true,
    monitoring_mode: "v1",
    retained_hold: "held",
    access_state: "HELD",
  };
  const send = (body: any, suffix = "timer") =>
    f.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${id}/${suffix}`,
      headers,
      payload: body,
    });
  const poll = async () => {
    const response = await signed("/api/agent/clock-changes", {
      agent: "class",
      nonce: randomBytes(32).toString("hex"),
      at: Date.now(),
      after: "",
    });
    expect(response.statusCode, response.body).toBe(200);
    return JSON.parse(Buffer.from(response.json().payload, "base64").toString())
      .requests as any[];
  };
  const apply = async (request: any, pending = false) => {
    const previous = remote.deadline;
    let paused = remote.timer_paused_at || 0,
      remaining = remote.timer_remaining_ms || 0;
    if (request.pause_timer) {
      paused = request.requested_at;
      remaining = previous - paused;
    } else if (request.resume_timer) {
      remote.deadline = request.requested_at + remaining;
      paused = 0;
      remaining = 0;
    } else {
      remaining = request.remaining_seconds * 1000;
      remote.deadline = paused + remaining;
    }
    const revision = remote.clock_revision + 1;
    const record = {
      id: request.reset_id,
      actor: request.actor,
      requested_at: request.requested_at,
      applied_at: Date.now(),
      previous_deadline: previous,
      deadline: remote.deadline,
      remaining_seconds: request.remaining_seconds,
      revision,
      ...(request.pause_timer ? { pause_timer: true } : {}),
      ...(request.resume_timer
        ? { resume_timer: true, applied_boot_ms: 100000 }
        : {}),
      ...(paused
        ? { timer_paused_at: paused, timer_remaining_ms: remaining }
        : {}),
    };
    remote = {
      ...remote,
      clock_revision: revision,
      clock_resets: [...remote.clock_resets, record],
      timer_paused_at: paused,
      timer_remaining_ms: remaining,
      registered_owner: { ...owner, clock_revision: revision },
      clock_handover_pending: pending,
    };
    const response = await signed("/api/agent/events", {
      agent: "class",
      sequence: ++sequence,
      attempt: remote,
    });
    expect(response.statusCode, response.body).toBe(200);
  };
  return {
    id,
    start,
    deadline,
    send,
    poll,
    apply,
    current: () => f,
    getRemote: () => remote,
    async restart() {
      await f.app.close();
      f.store.close();
      f = await createApp(config);
    },
    async close() {
      await f.app.close();
      f.store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

it.each([false, true])(
  "automatic countdown resume survives restart and delayed delivery (pending time edit: %s)",
  async (pendingEdit) => {
    const t = await fixture();
    let clock: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const pause = {
        timerAction: "pause",
        resumeOnWork: true,
        revision: 0,
        requestID: randomUUID(),
      };
      expect((await t.send(pause)).statusCode).toBe(200);
      const [request] = await t.poll();
      expect(request.pause_timer).toBe(true);
      expect(request).not.toHaveProperty("resume_on_work");
      expect(request).not.toHaveProperty("resume_on_work_generation");
      expect(request).not.toHaveProperty("resume_on_work_after");
      await t.apply(request);
      const remaining = t.current().store.attempt(t.id).timer_remaining_ms!;
      await t.restart();
      expect((await t.send(pause)).json().confirmed).toBe(true);
      expect(
        (await t.send({ ...pause, resumeOnWork: false })).statusCode,
      ).not.toBe(200);
      expect(await t.poll()).toEqual([]);
      const f = t.current(),
        grant = f.store.session("admin", "reviewer", null);
      const approved = await f.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${t.id}/authorize`,
        headers: {
          origin: "http://localhost:3000",
          cookie: `session=${grant.token}`,
          "x-csrf-token": grant.csrf,
        },
        payload: {
          generation: 1,
          revision: f.store.attempt(t.id).continuation_revision,
          requestID: randomUUID(),
          reason: "Synthetic reviewed resume",
          validForMinutes: null,
        },
      });
      expect(approved.statusCode, approved.body).toBe(200);
      expect(await t.poll()).toEqual([]); // approval is not work
      let edit: any;
      if (pendingEdit) {
        expect(
          (
            await t.send(
              { minutes: 10, revision: 1, requestID: randomUUID() },
              "reset-clock",
            )
          ).statusCode,
        ).toBe(200);
        [edit] = await t.poll();
      }
      f.life.confirmContinuation(t.id, 1); // genuine public Continue/refusal paths are covered by the retained fixture
      const resumedAt = (
        f.store.db
          .prepare(
            "SELECT at FROM audit WHERE target=? AND action='resume-continuation'",
          )
          .get(t.id) as any
      ).at;
      await t.restart();
      clock = vi.spyOn(Date, "now").mockReturnValue(resumedAt + 5000);
      if (pendingEdit) {
        expect((await t.poll())[0].reset_id).toBe(edit.reset_id);
        await t.apply(edit);
      }
      const [resume] = await t.poll();
      expect(resume).toMatchObject({
        resume_timer: true,
        requested_at: resumedAt,
        clock_revision: pendingEdit ? 2 : 1,
      });
      expect((await t.poll())[0]).toEqual(resume);
      await t.apply(resume);
      expect(t.current().store.attempt(t.id)).toMatchObject({
        deadline: resumedAt + (pendingEdit ? 600000 : remaining),
        original_deadline: t.deadline,
        start: t.start,
        timer_paused_at: 0,
        timer_remaining_ms: 0,
        access_state: "HELD",
      });
      expect(await t.poll()).toEqual([]);
      await t.restart();
      expect(await t.poll()).toEqual([]);
    } finally {
      clock?.mockRestore();
      await t.close();
    }
  },
);

it.each(["working", "manual", "completed"])(
  "automatic countdown option refuses or retires safely: %s",
  async (mode) => {
    const t = await fixture();
    try {
      if (mode === "working")
        t.current()
          .store.db.prepare("UPDATE attempts SET state='ACTIVE' WHERE id=?")
          .run(t.id);
      const response = await t.send({
        timerAction: "pause",
        resumeOnWork: true,
        revision: 0,
        requestID: randomUUID(),
      });
      if (mode === "working") {
        expect(response.statusCode).not.toBe(200);
        expect(await t.poll()).toEqual([]);
        return;
      }
      expect(response.statusCode, response.body).toBe(200);
      await t.apply((await t.poll())[0]);
      if (mode === "manual") {
        expect(
          (
            await t.send({
              timerAction: "resume",
              revision: 1,
              requestID: randomUUID(),
            })
          ).statusCode,
        ).toBe(200);
        await t.apply((await t.poll())[0]);
      } else
        t.current()
          .store.db.prepare(
            "UPDATE attempts SET state='COMPLETED',protected=1 WHERE id=?",
          )
          .run(t.id);
      expect(await t.poll()).toEqual([]);
      await t.restart();
      expect(await t.poll()).toEqual([]);
    } finally {
      await t.close();
    }
  },
);

it("an earlier resume or an earlier automatic pause cannot restart a new manual pause at the same timestamp", async () => {
  const t = await fixture(),
    at = Date.now(),
    clock = vi.spyOn(Date, "now").mockReturnValue(at);
  try {
    t.current().store.audit("alice", "resume-continuation", t.id, "1");
    expect(
      (
        await t.send({
          timerAction: "pause",
          resumeOnWork: true,
          revision: 0,
          requestID: randomUUID(),
        })
      ).statusCode,
    ).toBe(200);
    await t.apply((await t.poll())[0]);
    expect(await t.poll()).toEqual([]); // same millisecond, but causally before arming
    expect(
      (
        await t.send({
          timerAction: "resume",
          revision: 1,
          requestID: randomUUID(),
        })
      ).statusCode,
    ).toBe(200);
    await t.apply((await t.poll())[0]);
    expect(
      (
        await t.send({
          timerAction: "pause",
          revision: 2,
          requestID: randomUUID(),
        })
      ).statusCode,
    ).toBe(200);
    await t.apply((await t.poll())[0]);
    t.current().store.audit("alice", "resume-continuation", t.id, "1");
    expect(await t.poll()).toEqual([]); // only the OLD pause requested automatic resume
  } finally {
    clock.mockRestore();
    await t.close();
  }
});
