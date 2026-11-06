import { expect, it, vi } from "vitest";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { createApp } from "../../apps/server/src/app.js";
import { monitoringOwner } from "../../packages/protocol/monitoring-evidence.js";

// Real authenticated admin/native HTTP, SQLite and restart; native authority is
// a signed synthetic producer here. Actual PTY/past-deadline enforcement is Go.
it("pauses, revises and resumes a countdown through admin HTTP and signed native confirmation, preserving retry and restart", async () => {
  const dir = mkdtempSync(tmpdir() + "/timer-controls-"),
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
  const options = {
    logStream: new Writable({
      write(_c, _e, done) {
        done();
      },
    }),
  };
  let f = await createApp(config, options),
    sequence = 0;
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  try {
    const id = randomUUID(),
      at = Date.now(),
      start = at - 60000,
      original = at + 300000;
    const owner = monitoringOwner.parse({
      attempt: id,
      exam: "timer",
      username: "alice",
      uid: 1001,
      transport_hash: "a".repeat(64),
      boot: randomUUID(),
      page_epoch: "b".repeat(64),
      input_epoch: "c".repeat(64),
      generation: 0,
      clock_revision: 0,
    });
    f.store.db.prepare("INSERT INTO exams VALUES('timer','{}')").run();
    f.store.db
      .prepare(
        `INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,
      generation,monitoring_mode,registered_owner,retained_hold,access_state) VALUES(?,'timer','alice',1001,'LOCKED','{}',?,?,?,1,'v1',?,'held','HELD')`,
      )
      .run(id, start, original, original, JSON.stringify(owner));
    const admin = f.store.session("admin", "teacher", null),
      student = f.store.session("student", "alice", "timer");
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
    const health = await signed("/api/agent/events", {
      agent: "class",
      sequence: ++sequence,
      at,
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
    expect(health.statusCode, health.body).toBe(200);
    const pauseBody = {
      timerAction: "pause",
      revision: 0,
      requestID: randomUUID(),
    };
    const send = (body: any, customHeaders = headers, suffix = "timer") =>
      f.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${id}/${suffix}`,
        headers: customHeaders,
        payload: body,
      });
    expect(
      (
        await send(pauseBody, {
          ...headers,
          cookie: `session=${student.token}`,
          "x-csrf-token": student.csrf,
        })
      ).statusCode,
    ).toBe(401);
    const requested = await send(pauseBody);
    expect(requested.statusCode, requested.body).toBe(200);
    expect(requested.json().confirmed).toBe(false);
    const request = () =>
      JSON.parse(
        (
          f.store.db
            .prepare(
              "SELECT body FROM clock_reset_requests WHERE attempt=? AND status='pending'",
            )
            .get(id) as any
        ).body,
      );
    const pending = request();
    expect(pending).toMatchObject({
      pause_timer: true,
      remaining_seconds: 0,
      clock_revision: 0,
    });
    const history: any[] = [];
    let remaining = original - pending.requested_at;
    history.push({
      id: pending.reset_id,
      actor: pending.actor,
      requested_at: pending.requested_at,
      applied_at: Date.now(),
      previous_deadline: original,
      deadline: original,
      remaining_seconds: 0,
      revision: 1,
      pause_timer: true,
      timer_paused_at: pending.requested_at,
      timer_remaining_ms: remaining,
    });
    let remote: any = {
      id,
      exam: "timer",
      username: "alice",
      uid: 1001,
      state: "LOCKED",
      generation: 1,
      start,
      deadline: original,
      original_deadline: original,
      clock_revision: 1,
      clock_resets: history,
      registered_owner: { ...owner, clock_revision: 1 },
      boot: owner.boot,
      browser_ssh: true,
      terminal_supervised: true,
      monitoring_mode: "v1",
      retained_hold: "held",
      monitoring_hold_kind: "policy",
      access_state: "HELD",
      timer_paused_at: pending.requested_at,
      timer_remaining_ms: remaining,
    };
    const report = (patch: any = {}) =>
      signed("/api/agent/events", {
        agent: "class",
        sequence: ++sequence,
        at: Date.now(),
        attempt: { ...remote, ...patch },
      });
    const corrupt = await report({ timer_remaining_ms: remaining + 1 });
    expect(corrupt.statusCode).not.toBe(200);
    expect(f.store.attempt(id).clock_revision).toBe(0);
    const saved = await report({ clock_handover_pending: true });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(request().reset_id).toBe(pauseBody.requestID);
    const confirmed = await report({ clock_handover_pending: false });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(f.store.attempt(id)).toMatchObject({
      timer_paused_at: pending.requested_at,
      timer_remaining_ms: remaining,
      deadline: original,
      original_deadline: original,
      start,
      access_state: "HELD",
      state: "LOCKED",
    });
    await f.app.close();
    f.store.close();
    f = await createApp(config, options);
    const retry = await send(pauseBody);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toMatchObject({
      confirmed: true,
      attempt: { clock_revision: 1, timer_remaining_ms: remaining },
    });
    clock = vi.spyOn(Date, "now").mockReturnValue(original + 60000);
    expect(f.life.expireDeadline(id)).toBe(false);
    await f.life.tick();
    expect(f.store.attempt(id)).toMatchObject({
      state: "LOCKED",
      timer_remaining_ms: remaining,
      access_state: "HELD",
    });
    const revised = await send(
      { minutes: 10, revision: 1, requestID: randomUUID() },
      headers,
      "reset-clock",
    );
    expect(revised.statusCode, revised.body).toBe(200);
    expect(revised.json().confirmed).toBe(false);
    const edit = request();
    remaining = 600000;
    const revisedDeadline = pending.requested_at + remaining;
    history.push({
      id: edit.reset_id,
      actor: edit.actor,
      requested_at: edit.requested_at,
      applied_at: Date.now(),
      previous_deadline: original,
      deadline: revisedDeadline,
      remaining_seconds: 600,
      revision: 2,
      timer_paused_at: pending.requested_at,
      timer_remaining_ms: remaining,
    });
    remote = {
      ...remote,
      deadline: revisedDeadline,
      clock_revision: 2,
      registered_owner: { ...owner, clock_revision: 2 },
      timer_remaining_ms: remaining,
    };
    expect((await report()).statusCode).toBe(200);
    const review = (
      await f.app.inject({
        url: `/api/admin/attempts/${id}/interruption`,
        headers,
      })
    ).json();
    const approval = await f.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${id}/authorize`,
      headers,
      payload: {
        generation: review.generation,
        revision: review.revision,
        requestID: randomUUID(),
        reason: "Instructor reviewed paused countdown",
        validForMinutes: null,
      },
    });
    expect(approval.statusCode, approval.body).toBe(200);
    expect(approval.json()).toMatchObject({
      noExpiry: true,
      expires: Number.MAX_SAFE_INTEGER,
    });
    const resuming = await send({
      timerAction: "resume",
      revision: 2,
      requestID: randomUUID(),
    });
    expect(resuming.statusCode, resuming.body).toBe(200);
    const resume = request(),
      deadline = resume.requested_at + remaining;
    history.push({
      id: resume.reset_id,
      actor: resume.actor,
      requested_at: resume.requested_at,
      applied_at: Date.now(),
      previous_deadline: revisedDeadline,
      deadline,
      remaining_seconds: 0,
      revision: 3,
      resume_timer: true,
      applied_boot_ms: 100000,
    });
    remote = {
      ...remote,
      deadline,
      clock_revision: 3,
      registered_owner: { ...owner, clock_revision: 3 },
      timer_paused_at: 0,
      timer_remaining_ms: 0,
    };
    const applied = await report();
    expect(applied.statusCode, applied.body).toBe(200);
    expect(f.store.attempt(id)).toMatchObject({
      deadline,
      original_deadline: original,
      start,
      timer_paused_at: 0,
      timer_remaining_ms: 0,
      state: "LOCKED",
      access_state: "HELD",
    });
    expect(
      (
        await send({
          timerAction: "pause",
          revision: 2,
          requestID: randomUUID(),
        })
      ).statusCode,
    ).toBe(400);
    clock.mockReturnValue(deadline + 1);
    const expired = await send({
      timerAction: "pause",
      revision: 3,
      requestID: randomUUID(),
    });
    expect(expired.statusCode).not.toBe(200);
    expect(f.store.attempt(id).clock_revision).toBe(3);
  } finally {
    clock?.mockRestore();
    await f.app.close();
    f.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
