import { expect, it, vi } from "vitest";
import { randomUUID, sign } from "node:crypto";
import { hash } from "../../apps/server/src/db.js";
import {
  liveMonitoring,
  monitoringReady,
} from "../fixtures/live-monitoring.js";

// Real HTTP approval/Continue, owned connection worker and authenticated SSH.
// Native freeze/commit and browser epoch acknowledgement are simulated here;
// separate Go/JS tests exercise their actual public entries. This is not root
// all-writer or combined browser qualification.
it.each([false, true])(
  "same-page retained pause keeps SSH; failed native Continue retries approval before input agreement (automatic countdown: %s)",
  async (automaticCountdown) => {
    const f = await liveMonitoring({ ownedAttempt: true });
    const original = f.store.attempt(f.id),
      owner = {
        attempt: f.id,
        exam: original.exam,
        username: original.username,
        uid: original.uid,
        transport_hash: f.connection.transport,
        boot: "77777777-1234-4234-8234-123456789abc",
        page_epoch: hash(f.page),
        input_epoch: hash("original synthetic native authority"),
        generation: 0,
        clock_revision: 0,
      };
    f.store.db
      .prepare(
        "UPDATE attempts SET monitoring_mode='v1',registered_owner=? WHERE id=?",
      )
      .run(JSON.stringify(owner), f.id);
    const counts = { ...f.h.authCalls };
    let refuse = true,
      consumes = 0;
    let timerSnapshot: any = {};
    const next = {
      ...owner,
      generation: 1,
      input_epoch: hash("confirmed synthetic native Continue"),
    };
    f.h.control.command = async (op) => {
      if (op === "lock-attempt")
        return { id: f.id, state: "LOCKED", generation: 1 };
      if (op === "consume-monitored-continuation") {
        consumes++;
        if (refuse) throw Error("Synthetic native refusal before thaw");
        return {
          attempt: {
            ...original,
            ...timerSnapshot,
            generation: 1,
            registered_owner: next,
            settings: JSON.parse(original.settings),
            boot: owner.boot,
            state: "ACTIVE",
            browser_ssh: true,
            terminal_supervised: true,
            monitoring_mode: "v1",
          },
          input_epochs: {},
        };
      }
      throw Error("Unexpected synthetic native operation: " + op);
    };
    const epochs = vi
      .spyOn(f.connection, "changeInputEpochs")
      .mockResolvedValue({});
    try {
      await f.life.lock(f.id, "Synthetic confirmed policy loss");
      await vi.waitFor(() =>
        expect(
          f.messages.some(
            (m) => m.type === "state" && m.attempt?.state === "LOCKED",
          ),
        ).toBe(true),
      );
      expect(f.connection.alive).toBe(true);
      expect(
        f.messages.find(
          (m) => m.type === "state" && m.attempt?.state === "LOCKED",
        ).authenticationGap,
      ).toBe(false);
      const admin = f.store.session("admin", "synthetic-instructor", null);
      if (automaticCountdown) {
        const health = Buffer.from(
          JSON.stringify({
            agent: "class",
            sequence: 1,
            health: {
              ready: true,
              capabilities: [
                "clock-reset",
                "deadline-timing-check",
                "timer-clock-controls-v1",
              ],
            },
          }),
        );
        const reported = await f.app.inject({
          method: "POST",
          url: "/api/agent/events",
          payload: health,
          headers: {
            "content-type": "application/vnd.ssh-exam-event",
            "x-exam-signature": sign(null, health, f.h.callbackKey).toString(
              "base64",
            ),
          },
        });
        expect(reported.statusCode, reported.body).toBe(200);
        const paused = await f.app.inject({
          method: "POST",
          url: `/api/admin/attempts/${f.id}/timer`,
          headers: {
            origin: f.headers.origin,
            cookie: `session=${admin.token}`,
            "x-csrf-token": admin.csrf,
          },
          payload: {
            timerAction: "pause",
            resumeOnWork: true,
            revision: 0,
            requestID: randomUUID(),
          },
        });
        expect(paused.statusCode, paused.body).toBe(200);
        const request = paused.json().pending,
          at = request.requested_at;
        next.clock_revision = 1;
        timerSnapshot = {
          clock_revision: 1,
          timer_paused_at: at,
          timer_remaining_ms: original.deadline! - at,
          clock_resets: [
            {
              id: request.reset_id,
              actor: request.actor,
              requested_at: at,
              applied_at: Date.now(),
              previous_deadline: original.deadline,
              deadline: original.deadline,
              remaining_seconds: 0,
              revision: 1,
              pause_timer: true,
              timer_paused_at: at,
              timer_remaining_ms: original.deadline! - at,
            },
          ],
        };
        f.life.acceptRemote({
          ...original,
          ...timerSnapshot,
          generation: 1,
          state: "LOCKED",
          registered_owner: { ...owner, clock_revision: 1 },
          boot: owner.boot,
          browser_ssh: true,
          terminal_supervised: true,
          monitoring_mode: "v1",
          retained_hold: "held",
        });
      }
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
          reason: "Synthetic reviewed retained pause",
        },
      });
      expect(approval.statusCode, approval.body).toBe(200);
      expect(
        f.store.db
          .prepare(
            "SELECT 1 FROM audit WHERE target=? AND action='authorized-authentication-gap'",
          )
          .get(f.id),
      ).toBeUndefined();
      const continueAttempt = () =>
        f.app.inject({
          method: "POST",
          url: `/api/student/attempts/${f.id}/continue`,
          headers: f.headers,
          payload: monitoringReady,
        });
      const failed = await continueAttempt();
      expect(failed.statusCode, failed.body).toBe(400);
      expect(consumes).toBe(1);
      expect(
        f.store.db
          .prepare(
            "SELECT id FROM clock_reset_requests WHERE attempt=? AND status='pending'",
          )
          .get(f.id),
      ).toBeUndefined();
      expect(epochs).not.toHaveBeenCalled();
      expect(f.connection.alive).toBe(true);
      expect(f.store.attempt(f.id)).toMatchObject({
        state: "LOCKED",
        generation: 1,
        start: original.start,
        deadline: original.deadline,
      });
      expect(
        f.store.db
          .prepare("SELECT consumed FROM continuations WHERE attempt=?")
          .get(f.id),
      ).toEqual({ consumed: 0 });
      refuse = false;
      epochs.mockRejectedValueOnce(
        Error("Synthetic browser acknowledgement lost"),
      );
      const pending = await continueAttempt();
      expect(pending.statusCode, pending.body).toBe(400);
      expect(
        f.store.db
          .prepare(
            "SELECT id FROM clock_reset_requests WHERE attempt=? AND status='pending'",
          )
          .get(f.id),
      ).toBeUndefined();
      expect(pending.json().error).toContain(
        "Synthetic browser acknowledgement lost",
      );
      expect(epochs).toHaveBeenCalledOnce();
      expect(f.store.attempt(f.id)).toMatchObject({
        state: "LOCKED",
        generation: 1,
      });
      expect(
        f.store.db
          .prepare("SELECT consumed FROM continuations WHERE attempt=?")
          .get(f.id),
      ).toEqual({ consumed: 1 });
      const pendingStatus = await f.app.inject({
        method: "GET",
        url: `/api/student/attempts/${f.id}/status`,
        headers: f.headers,
      });
      expect(pendingStatus.statusCode, pendingStatus.body).toBe(200);
      expect(pendingStatus.json().continuation).toMatchObject({
        state: "completing",
        execution: false,
      });
      const reauth = await f.app.inject({
        method: "POST",
        url: `/api/student/attempts/${f.id}/reauth`,
        headers: f.headers,
        payload: {},
      });
      expect(reauth.statusCode, reauth.body).toBe(400);
      expect(reauth.json().error).toContain(
        "Ask your instructor to approve resuming, then sign in again. Your deadline is unchanged.",
      );
      expect(f.connection.alive).toBe(true);
      const continued = await continueAttempt();
      expect(continued.statusCode, continued.body).toBe(200);
      expect(continued.json()).toMatchObject({
        attempt: { state: "ACTIVE", generation: 1 },
        inputEpochs: {},
      });
      const automaticIntent = f.store.db
        .prepare(
          "SELECT body FROM clock_reset_requests WHERE attempt=? AND status='pending'",
        )
        .get(f.id) as any;
      if (automaticCountdown) {
        expect(JSON.parse(automaticIntent.body)).toMatchObject({
          resume_timer: true,
          clock_revision: 1,
        });
        const resumed = f.store.db
          .prepare(
            "SELECT at FROM audit WHERE target=? AND action='resume-continuation'",
          )
          .get(f.id) as any;
        expect(JSON.parse(automaticIntent.body).requested_at).toBe(resumed.at);
      } else expect(automaticIntent).toBeUndefined();
      expect(epochs).toHaveBeenCalledTimes(2);
      expect(epochs).toHaveBeenLastCalledWith(f.id, {});
      // Lost final HTTP reply: the same live native result must still complete
      // input agreement after the web outcome was committed, without reapproval.
      const finalRetry = await continueAttempt();
      expect(finalRetry.statusCode, finalRetry.body).toBe(200);
      expect(finalRetry.json().attempt.generation).toBe(1);
      expect(f.h.authCalls).toEqual(counts);
      expect(f.store.attempt(f.id)).toMatchObject({
        start: original.start,
        deadline: original.deadline,
        original_deadline: original.original_deadline,
      });
    } finally {
      epochs.mockRestore();
      await f.close();
    }
  },
);

it.each(["claim"])(
  "retained %s refuses reusing the old transport before changing a valid unused approval, session or interval",
  async (operation) => {
    const f = await liveMonitoring({ ownedAttempt: true });
    const original = f.store.attempt(f.id);
    const owner = {
      attempt: f.id,
      exam: original.exam,
      username: original.username,
      uid: original.uid,
      transport_hash: f.connection.transport,
      boot: "77777777-1234-4234-8234-123456789abc",
      page_epoch: hash(f.page),
      input_epoch: hash("original retained input authority"),
      generation: 0,
      clock_revision: 0,
    };
    f.store.db
      .prepare(
        "UPDATE attempts SET monitoring_mode='v1',registered_owner=? WHERE id=?",
      )
      .run(JSON.stringify(owner), f.id);
    f.h.control.command = async (op) => {
      if (op === "lock-attempt")
        return { id: f.id, state: "LOCKED", generation: 1 };
      throw Error("Unexpected replacement native operation: " + op);
    };
    try {
      await f.life.lock(f.id, "Synthetic policy pause with retained SSH");
      const admin = f.store.session("admin", "synthetic-instructor", null);
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
          reason: "Reviewed SAME-page Continue, never a replacement transport",
        },
      });
      expect(approval.statusCode, approval.body).toBe(200);
      const approved = f.store.db
        .prepare("SELECT * FROM continuations WHERE attempt=?")
        .get(f.id);
      expect(approved).toMatchObject({ consumed: 0, generation: 1 });
      const before = f.store.attempt(f.id);
      const authCalls = { ...f.h.authCalls };
      const close = vi.spyOn(f.connection, "close");
      const command = vi.spyOn(f.connection, "command");
      const refused = await f.app.inject({
        method: "POST",
        url: `/api/student/attempts/${f.id}/${operation}`,
        headers: f.headers,
        payload: {},
      });
      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.json().error).toContain(
        "Sign in again to resume from saved files in new terminals. Your deadline is unchanged.",
      );
      expect(close).not.toHaveBeenCalled();
      expect(command.mock.calls.some(([op]) => op === "attach-transport")).toBe(
        false,
      );
      expect(f.connection.alive).toBe(true);
      expect(
        f.store.db
          .prepare("SELECT * FROM continuations WHERE attempt=?")
          .get(f.id),
      ).toEqual(approved);
      for (const key of [
        "state",
        "generation",
        "start",
        "deadline",
        "original_deadline",
        "page_hash",
        "registered_owner",
        "grant_id",
        "access_state",
        "protected",
      ] as const)
        expect(f.store.attempt(f.id)[key], key).toEqual(before[key]);
      const session = await f.app.inject({
        method: "GET",
        url: "/api/session",
        headers: f.headers,
      });
      expect(session.statusCode, session.body).toBe(200);
      expect(session.json().username).toBe(original.username);
      expect(f.h.authCalls).toEqual(authCalls);
    } finally {
      await f.close();
    }
  },
);
