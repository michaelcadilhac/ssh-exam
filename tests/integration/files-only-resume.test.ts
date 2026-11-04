import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import sharp from "sharp";
import {
  liveMonitoring,
  monitoringReady,
} from "../fixtures/live-monitoring.js";
import { hash } from "../../apps/server/src/db.js";

// Real student HTTP, cookies/CSRF, two fresh authenticated SSH dialogues and
// signed command receipts. Native exit/cleanup/authority are simulated; actual
// pidfd/IPC/TLS/cgroup tests qualify that separate boundary.
it("approved fresh SSH resumes the original attempt only after restored capture and explicit Resume", async () => {
  const f = await liveMonitoring({ ownedAttempt: true });
  const original = f.store.attempt(f.id),
    oldConnection = f.connection;
  const owner = {
    attempt: f.id,
    exam: original.exam,
    username: original.username,
    uid: original.uid,
    transport_hash: oldConnection.transport,
    boot: "77777777-1234-4234-8234-123456789abc",
    page_epoch: hash(f.page),
    input_epoch: hash("original input"),
    generation: 0,
    clock_revision: 0,
  };
  f.store.db
    .prepare(
      "UPDATE attempts SET monitoring_mode='v1',registered_owner=?,access_state='HELD' WHERE id=?",
    )
    .run(JSON.stringify(owner), f.id);
  let refuse = true;
  const calls: string[] = [];
  f.h.control.command = async (op, body, command) => {
    calls.push(op);
    if (op === "lock-attempt")
      return { id: f.id, state: "LOCKED", generation: 1 };
    if (op === "register") {
      expect(body.continuation).toMatchObject({ id: f.id, generation: 1 });
      return {};
    }
    if (op === "resolve-course-accounts") return { student: original.uid };
    if (
      op === "consume-files-continuation" ||
      op === "consume-monitored-continuation"
    ) {
      expect(command.transport).not.toBe(owner.transport_hash);
      expect(body.page_epoch).not.toBe(owner.page_epoch);
      if (refuse)
        throw Error("Synthetic old-workload cleanup not yet confirmed");
      return {
        files_only: true,
        attempt: {
          ...original,
          settings: JSON.parse(original.settings),
          generation: 1,
          state: "ACTIVE",
          browser_ssh: true,
          terminal_supervised: true,
          monitoring_mode: "v1",
          monitoring_resume_kind: "reviewed",
          monitoring_resume_nonce: hash("fresh native nonce"),
          boot: owner.boot,
          registered_owner: {
            ...owner,
            generation: 1,
            transport_hash: command.transport,
            page_epoch: body.page_epoch,
            input_epoch: hash("new native input"),
          },
        },
        input_epochs: {},
      };
    }
    throw Error("Unexpected native operation " + op);
  };
  let auth: WebSocket | undefined;
  try {
    await f.life.lock(f.id, "Synthetic confirmed SSH exit");
    f.store.audit(
      "class-agent",
      "native-ssh-exited",
      f.id,
      JSON.stringify(owner),
    );
    const admin = f.store.session("admin", "files-resume-instructor", null);
    const approval = await f.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${f.id}/authorize`,
      headers: {
        origin: f.headers.origin,
        cookie: `session=${admin.token}`,
        "x-csrf-token": admin.csrf,
      },
      payload: {
        generation: 1,
        revision: f.store.attempt(f.id).continuation_revision,
        requestID: randomUUID(),
        reason: "Reviewed same-deadline files-only resume",
      },
    });
    expect(approval.statusCode, approval.body).toBe(200);
    const reauth = await f.app.inject({
      method: "POST",
      url: `/api/student/attempts/${f.id}/reauth`,
      headers: f.headers,
      payload: {},
    });
    expect(reauth.statusCode, reauth.body).toBe(200);
    const start = await f.app.inject({
      method: "POST",
      url: "/api/auth/start",
      headers: { origin: f.headers.origin },
      payload: {},
    });
    const dialogue = String(start.headers["set-cookie"]).split(";")[0];
    auth = new WebSocket(
      f.headers.origin.replace("http:", "ws:") + "/api/auth/dialogue",
      { headers: { origin: f.headers.origin, cookie: dialogue } },
    );
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("Fresh synthetic SSH dialogue timed out")),
        8000,
      );
      auth!.once("error", reject);
      auth!.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === "challenge" && m.prompts.length)
          auth!.send(
            JSON.stringify({
              v: 1,
              type: "answers",
              round: m.round,
              answers: m.prompts.map(() => "shared-password"),
            }),
          );
        if (m.type === "authenticated") {
          clearTimeout(timeout);
          resolve();
        }
        if (m.type === "error") {
          clearTimeout(timeout);
          reject(Error(m.error));
        }
      });
      auth!.once("open", () =>
        auth!.send(
          JSON.stringify({
            v: 1,
            type: "start",
            exam: original.exam,
            username: original.username,
          }),
        ),
      );
    });
    const completed = await f.app.inject({
      method: "POST",
      url: "/api/auth/complete",
      headers: { origin: f.headers.origin, cookie: dialogue },
      payload: {},
    });
    expect(completed.statusCode, completed.body).toBe(200);
    const cookie = String(completed.headers["set-cookie"])
      .split(",")
      .find((c) => c.trim().startsWith("session="))!
      .trim()
      .split(";")[0];
    const headers = {
      origin: f.headers.origin,
      cookie,
      "x-csrf-token": completed.json().csrf,
      "x-page-instance": "",
    };
    const claim = await f.app.inject({
      method: "POST",
      url: `/api/student/attempts/${f.id}/claim`,
      headers,
      payload: {},
    });
    expect(claim.statusCode, claim.body).toBe(200);
    headers["x-page-instance"] = claim.json().page;
    expect(f.connection.transport).not.toBe(oldConnection.transport);
    expect(f.h.authCalls).toEqual({ jump: 2, class: 2 });
    // This fixture owns real SSH using the Node control client, rather than a
    // browser WASM peer. Model only the negotiated feature acknowledgement;
    // the actual guarded browser test uses the real matching feature exchange.
    const features = vi
      .spyOn(f.connection, "prepareMonitoring")
      .mockResolvedValue(false);
    const resume = () =>
      f.app.inject({
        method: "POST",
        url: `/api/student/attempts/${f.id}/continue`,
        headers,
        payload: monitoringReady,
      });
    expect((await resume()).statusCode).toBe(400); // No current capture yet.
    expect(calls).not.toContain("consume-files-continuation");
    const jpeg = (
      await sharp({
        create: { width: 2, height: 2, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer()
    ).toString("base64");
    for (const source of ["screen", "webcam"]) {
      const ticket = await f.app.inject({
        method: "POST",
        url: `/api/student/attempts/${f.id}/capture-challenges`,
        headers,
        payload: { source },
      });
      expect(ticket.statusCode, ticket.body).toBe(200);
      const capture = await f.app.inject({
        method: "POST",
        url: `/api/student/attempts/${f.id}/frames/challenged`,
        headers,
        payload: {
          source,
          seq: ticket.json().after_sequence + 1,
          challenge: ticket.json().challenge,
          captured: Date.now(),
          monotonic: 1,
          readiness: monitoringReady,
          data: jpeg,
        },
      });
      expect(capture.statusCode, capture.body).toBe(200);
    }
    const unsupported = await resume();
    expect(unsupported.statusCode, unsupported.body).toBe(400);
    expect(calls).not.toContain("consume-files-continuation");
    features.mockResolvedValue(true);
    const failed = await resume();
    expect(failed.statusCode, failed.body).toBe(400);
    expect(calls).toContain("consume-files-continuation");
    expect(
      f.store.db
        .prepare("SELECT consumed FROM continuations WHERE attempt=?")
        .get(f.id),
    ).toEqual({ consumed: 0 });
    refuse = false;
    const resumed = await resume();
    expect(resumed.statusCode, resumed.body).toBe(200);
    expect(resumed.json().attempt).toMatchObject({
      id: f.id,
      state: "ACTIVE",
      start: original.start,
      deadline: original.deadline,
      original_deadline: original.original_deadline,
      access_state: "HELD",
    });
    expect(
      f.store.db
        .prepare("SELECT consumed FROM continuations WHERE attempt=?")
        .get(f.id),
    ).toEqual({ consumed: 1 });
    expect(f.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 1 },
    );
    expect(
      calls.some(
        (op) => op.startsWith("activate-") || op === "attach-transport",
      ),
    ).toBe(false);
    const retry = await resume();
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json().attempt.deadline).toBe(original.deadline);
  } finally {
    auth?.terminate();
    await f.close();
  }
}, 20000);
