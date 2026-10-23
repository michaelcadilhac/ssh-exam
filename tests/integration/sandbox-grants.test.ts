import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  createPublicKey,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import WebSocket from "ws";
import { createApp } from "../../apps/server/src/app.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { grantExam } from "../fixtures/grant-exam.js";
import { hosts } from "../fixtures/hosts.js";
import { freshCapture } from "../fixtures/fresh-capture.js";

it.each([
  "first",
  "old-role",
  "old-cleanup-role",
  "lost-stage-reply",
  "manual-future-window",
  "cancelled-retry",
  "revoked",
  "expired",
  "cleanup-pending",
  "restore-pending",
  "repeat",
  "repeat-contradictory-claim",
])(
  "sandbox SSH/preflight saves a one-use finite practice grant (%s)",
  async (scenario) => {
    const h = await hosts(),
      data = mkdtempSync(tmpdir() + "/sandbox-grants-");
    const config = {
      mode: "development" as const,
      origin: "http://127.0.0.1",
      port: 0,
      data,
      maintenance: false,
      jump: h.jump,
      class: h.class,
      agent: h.agentConfig,
    };
    const { app, store } = await createApp(config),
      native = new Map<string, any>(),
      manifests = new Map<string, any>(),
      sockets: WebSocket[] = [],
      operations: string[] = [];
    let support = scenario !== "old-role",
      cleanupSupport = scenario !== "old-cleanup-role",
      agreements = 0,
      workspaceCopies = 0,
      lostStage = false;
    h.control.command = async (op, b) => {
      operations.push(op);
      if (op === "register") return { uid: 10001 };
      if (op === "resolve-course-accounts") return { student: 10001 };
      if (op === "health")
        return {
          ready: true,
          fixture: true,
          capabilities: [
            "sandbox-begin-window-v1",
            "immutable-template-versions-v1",
            "exact-template-begin-v1",
            "private-workspace-staging",
            "unified-initial-grants-v1",
            "ordered-template-grants-v1",
            ...(cleanupSupport ? ["verified-preflight-cancellation-v1"] : []),
            ...(support ? ["unified-sandbox-grants-v1"] : []),
          ],
        };
      if (op === "prepare-practice-grant-attempt") {
        expect(b.grant).toMatchObject({
          kind: "PRACTICE",
          id: expect.any(String),
          revision: expect.any(Number),
        });
        expect(b.settings).toMatchObject({
          id: "sandbox",
          duration: 300,
          webcam: false,
          terminals: 4,
        });
        if (!native.has(b.id))
          native.set(b.id, {
            ...b,
            state: "PREPARING",
            start: 0,
            deadline: 0,
            original_deadline: 0,
          });
        return { ...native.get(b.id) };
      }
      const a = native.get(b.id);
      if (!a)
        throw Error(
          "Expected grant-aware practice purpose; grantless native preparation is unsupported",
        );
      if (op === "prepare-workspace") {
        if (!a.workspace) {
          workspaceCopies++;
          a.workspace = {
            version: 1,
            attempt: a.id,
            grant: a.grant,
            source: {
              kind: "template",
              template: a.settings.template,
              version: a.settings.template_version,
            },
          };
        }
        if (scenario === "lost-stage-reply" && !lostStage) {
          lostStage = true;
          throw Error("Synthetic lost practice staging receipt");
        }
        return { ...a };
      }
      if (op === "inspect-attempt") {
        if (a.state === "COMPLETED" && Date.now() >= a.original_deadline)
          a.access_state = "RELEASED";
        return { ...a };
      }
      if (op === "submission-manifest") return manifests.get(a.id);
      if (op === "finalize-attempt") {
        Object.assign(a, {
          state: "COMPLETED",
          protected: true,
          checksum: "b".repeat(64),
          ended: Date.now(),
          access_state: Date.now() >= a.original_deadline ? "RELEASED" : "HELD",
        });
        if (!manifests.has(a.id))
          manifests.set(a.id, {
            attempt: JSON.parse(JSON.stringify(a)),
            checksum: a.checksum,
            files: [],
            collected: a.ended,
            secured: a.ended,
          });
        return { ...a };
      }
      if (op === "cancel-attempt") {
        expect(a.start).toBe(0);
        Object.assign(a, {
          state: "CANCELLED_BEFORE_START",
          policy_state:
            scenario === "restore-pending" ? "RESTORE_PENDING" : "NORMAL",
          cancellation_cleanup_complete: scenario !== "cleanup-pending",
          ended: Date.now(),
        });
        return { ...a };
      }
      if (op === "lock-attempt") {
        a.state = "LOCKED";
        return { ...a };
      }
      if (op === "activate-practice-grant-attempt") {
        expect(b.grant).toEqual(a.grant);
        if (a.start) return { ...a };
        const nonce = randomBytes(32).toString("hex"),
          boot = "77777777-1234-4234-8234-123456789abc";
        const payload = Buffer.from(
          JSON.stringify({
            type: "grant-begin/v2",
            agent: "class",
            nonce,
            at: Date.now(),
            attempt: a.id,
            exam: a.exam,
            username: a.username,
            uid: a.uid,
            grant: a.grant,
            intent: b.grant_begin_intent,
            transport: a.transport,
            boot,
            settings: a.settings,
          }),
        );
        const reply = await app.inject({
          method: "POST",
          url: "/api/agent/grant-begin",
          headers: {
            "content-type": "application/vnd.ssh-exam-event",
            "x-exam-signature": sign(null, payload, h.callbackKey).toString(
              "base64",
            ),
          },
          payload,
        });
        expect(reply.statusCode, reply.body).toBe(200);
        const frame = reply.json(),
          signed = Buffer.from(frame.payload, "base64");
        expect(
          verify(
            null,
            signed,
            createPublicKey(readFileSync(h.agentConfig.signingKey)),
            Buffer.from(frame.signature, "base64"),
          ),
        ).toBe(true);
        expect(JSON.parse(signed.toString())).toMatchObject({
          type: "grant-begin/v2",
          nonce,
          grant: a.grant,
          intent: b.grant_begin_intent,
          transport: a.transport,
          boot,
        });
        agreements++;
        const start = Date.now();
        Object.assign(a, {
          state: "ACTIVE",
          start,
          deadline: start + 300000,
          original_deadline: start + 300000,
          grant_begin_intent: b.grant_begin_intent,
          access_state: "HELD",
          work_path: "/work",
        });
        return { ...a };
      }
      throw Error("Unexpected synthetic practice command: " + op);
    };
    try {
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      config.origin = origin;
      grantExam(store, "sandbox");
      const definitions = new ExamDefinitions(store, "class"),
        current = definitions.show("sandbox");
      definitions.update(
        "sandbox",
        { duration: 300, webcam: false, terminals: 4 },
        current.revision,
        "instructor",
        "Configure finite exact practice policy",
      );
      if (scenario === "manual-future-window") {
        const admin = store.session("admin", "instructor", null),
          headers = {
            origin,
            cookie: `session=${admin.token}`,
            "x-csrf-token": admin.csrf,
          };
        const enrolled = await app.inject({
          method: "POST",
          url: "/api/admin/exams/sandbox/roster/add",
          headers,
          payload: { username: "student" },
        });
        expect(enrolled.statusCode, enrolled.body).toBe(200);
        const selected = definitions.show("sandbox"),
          review = await app.inject({
            method: "POST",
            url: "/api/admin/exams/sandbox/grants/additional-preview",
            headers,
            payload: {
              definition_revision: selected.revision,
              template_version: selected.exam.template_version,
              earliest: Date.now() + 60000,
              latest: Date.now() + 600000,
              usernames: ["student"],
              duration: 300,
              reason: "Explicit future practice window independent of defaults",
            },
          });
        expect(review.statusCode, review.body).toBe(200);
        const confirmed = await app.inject({
          method: "POST",
          url: `/api/admin/grant-issuance/${review.json().id}/confirm`,
          headers,
          payload: { revision: review.json().revision },
        });
        expect(confirmed.statusCode, confirmed.body).toBe(200);
      }
      const login = async () => {
        const started = await app.inject({
            method: "POST",
            url: "/api/auth/start",
            headers: { origin },
            payload: {},
          }),
          cookie = String(started.headers["set-cookie"]).split(";")[0];
        const ws = new WebSocket(
          origin.replace("http:", "ws:") + "/api/auth/dialogue",
          { headers: { origin, cookie } },
        );
        sockets.push(ws);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(Error("Synthetic practice SSH authentication timed out")),
            10000,
          );
          const finish = (e?: Error) => {
            clearTimeout(timer);
            e ? reject(e) : resolve();
          };
          ws.on("open", () =>
            ws.send(
              JSON.stringify({
                v: 1,
                type: "start",
                exam: "sandbox",
                username: "student",
              }),
            ),
          );
          ws.on("error", finish);
          ws.on("message", (data) => {
            const m = JSON.parse(data.toString());
            if (m.type === "challenge" && m.prompts.length)
              ws.send(
                JSON.stringify({
                  v: 1,
                  type: "answers",
                  round: m.round,
                  answers: m.prompts.map(() => "shared-password"),
                }),
              );
            if (m.type === "authenticated") finish();
            if (m.type === "error") finish(Error(m.error));
          });
        });
        const completed = await app.inject({
          method: "POST",
          url: "/api/auth/complete",
          headers: { origin, cookie },
          payload: {},
        });
        expect(completed.statusCode, completed.body).toBe(200);
        const cookies = completed.headers["set-cookie"],
          sessionCookie = (Array.isArray(cookies) ? cookies : [String(cookies)])
            .find((c) => c.startsWith("session="))!
            .split(";")[0];
        const session = (
          await app.inject({
            url: "/api/session",
            headers: { cookie: sessionCookie },
          })
        ).json();
        return { origin, cookie: sessionCookie, "x-csrf-token": session.csrf };
      };
      let headers = await login();
      expect(
        store.db
          .prepare(
            "SELECT uid FROM enrollments WHERE exam='sandbox' AND username='student'",
          )
          .get(),
      ).toEqual({ uid: 10001 });
      const preflight = () =>
        app.inject({
          method: "POST",
          url: "/api/student/preflight",
          headers,
          payload: {},
        });
      let prepared = await preflight();
      if (scenario === "manual-future-window") {
        expect(prepared.statusCode, prepared.body).toBe(400);
        expect(prepared.body).toContain("Outside allowed start window");
        expect(
          store.db.prepare("SELECT count(*) n FROM attempts").get(),
        ).toEqual({ n: 0 });
        expect(
          store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
        ).toEqual({ n: 0 });
        expect(
          store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
        ).toEqual({ n: 1 });
        expect(operations).not.toContain("prepare-practice-grant-attempt");
        return;
      }
      if (scenario === "lost-stage-reply") {
        expect(prepared.statusCode, prepared.body).toBe(400);
        expect(prepared.body).toContain(
          "Synthetic lost practice staging receipt",
        );
        const pending = store.db.prepare("SELECT * FROM attempts").get() as any;
        expect(pending).toMatchObject({
          state: "PREPARING",
          start: null,
          deadline: null,
        });
        expect(native.get(pending.id).start).toBe(0);
        expect(workspaceCopies).toBe(1);
        prepared = await preflight();
        expect(prepared.statusCode, prepared.body).toBe(200);
        expect(prepared.json().id).toBe(pending.id);
        expect(workspaceCopies).toBe(1);
      }
      if (scenario === "old-role" || scenario === "old-cleanup-role") {
        expect(prepared.statusCode).toBe(400);
        expect(prepared.body).toContain("practice grant");
        expect(
          store.db.prepare("SELECT count(*) n FROM attempts").get(),
        ).toEqual({ n: 0 });
        expect(
          store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
        ).toEqual({ n: 0 });
        expect(operations).not.toContain("prepare-practice-grant-attempt");
        support = true;
        cleanupSupport = true;
        prepared = await preflight();
      }
      expect(prepared.statusCode, prepared.body).toBe(200);
      let { id, page } = prepared.json();
      let grantID = store.attempt(id).grant_id;
      expect(store.attempt(id)).toMatchObject({
        grant_kind: "PRACTICE",
        grant_id: expect.any(String),
        start: null,
        deadline: null,
      });
      const granted = store.db
        .prepare("SELECT * FROM attempt_grants WHERE id=?")
        .get(grantID) as any;
      expect(granted).toMatchObject({
        issuance: "PRACTICE",
        status: "AVAILABLE",
      });
      if (
        [
          "cancelled-retry",
          "revoked",
          "expired",
          "cleanup-pending",
          "restore-pending",
        ].includes(scenario)
      ) {
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/api/logout",
              headers,
              payload: {},
            })
          ).statusCode,
        ).toBe(200);
        expect(store.attempt(id).state).toBe("CANCELLED_BEFORE_START");
        const admin = store.session("admin", "instructor", null),
          rootHeaders = {
            origin,
            cookie: `session=${admin.token}`,
            "x-csrf-token": admin.csrf,
          };
        if (scenario === "cleanup-pending" || scenario === "restore-pending") {
          expect(
            store.db
              .prepare("SELECT state FROM grant_claims WHERE attempt=?")
              .get(id),
          ).toEqual({ state: "PREPARING" });
          const refused = await app.inject({
            method: "POST",
            url: `/api/admin/grants/${grantID}/revoke`,
            headers: rootHeaders,
            payload: {
              revision: 1,
              reason: "Refuse withdrawal before verified cleanup/restoration",
            },
          });
          expect(refused.statusCode, refused.body).toBe(409);
          Object.assign(native.get(id), {
            cancellation_cleanup_complete: true,
            policy_state: "NORMAL",
          });
          const receipt = Buffer.from(
            JSON.stringify({
              agent: "class",
              sequence: 1,
              at: Date.now(),
              attempt: { ...native.get(id) },
            }),
          );
          const ack = await app.inject({
            method: "POST",
            url: "/api/agent/events",
            headers: {
              "content-type": "application/vnd.ssh-exam-event",
              "x-exam-signature": sign(null, receipt, h.callbackKey).toString(
                "base64",
              ),
            },
            payload: receipt,
          });
          expect(ack.statusCode, ack.body).toBe(200);
          expect(
            store.db
              .prepare("SELECT state FROM grant_claims WHERE attempt=?")
              .get(id),
          ).toEqual({ state: "CANCELLED" });
        }
        if (scenario === "revoked" || scenario === "expired") {
          const action = scenario === "revoked" ? "revoke" : "revise";
          const result = await app.inject({
            method: "POST",
            url: `/api/admin/grants/${grantID}/${action}`,
            headers: rootHeaders,
            payload: {
              revision: 1,
              reason: "Explicit unused practice authorization change",
              ...(action === "revise"
                ? {
                    changes: {
                      earliest: Date.now() - 120000,
                      latest: Date.now() - 60000,
                    },
                  }
                : {}),
            },
          });
          expect(result.statusCode, result.body).toBe(200);
        }
        headers = await login();
        prepared = await preflight();
        if (scenario === "revoked" || scenario === "expired") {
          expect(prepared.statusCode).toBe(409);
          expect(prepared.body).toMatch(/practice|sandbox/);
          expect(
            store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
          ).toEqual({ n: 1 });
          if (scenario === "revoked") {
            const current = definitions.show("sandbox");
            definitions.update(
              "sandbox",
              { earliest: Date.now() - 120000, latest: Date.now() - 60000 },
              current.revision,
              "instructor",
              "Close automatic defaults; explicitly choose new grant window",
            );
            const definition = definitions.show("sandbox");
            const review = await app.inject({
              method: "POST",
              url: "/api/admin/exams/sandbox/grants/additional-preview",
              headers: rootHeaders,
              payload: {
                definition_revision: definition.revision,
                template_version: definition.exam.template_version,
                earliest: Date.now() - 1000,
                latest: Date.now() + 600000,
                usernames: ["student"],
                duration: 300,
                reason: "Reviewed NEW practice after explicit revocation",
                request: randomUUID(),
              },
            });
            expect(review.statusCode, review.body).toBe(200);
            expect(review.json().kind).toBe("NEW_SANDBOX_PRACTICE_GRANTS");
            const intent = {
              revision: review.json().revision,
              request: randomUUID(),
            };
            const confirmed = await app.inject({
              method: "POST",
              url: `/api/admin/grant-issuance/${review.json().id}/confirm`,
              headers: rootHeaders,
              payload: intent,
            });
            expect(confirmed.statusCode, confirmed.body).toBe(200);
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: `/api/admin/grant-issuance/${review.json().id}/confirm`,
                  headers: rootHeaders,
                  payload: intent,
                })
              ).json(),
            ).toEqual(confirmed.json());
            expect(
              store.db
                .prepare("SELECT status FROM attempt_grants WHERE id=?")
                .get(grantID),
            ).toEqual({ status: "REVOKED" });
            grantID = confirmed.json().issued[0].grant;
          } else {
            const revised = await app.inject({
              method: "POST",
              url: `/api/admin/grants/${grantID}/revise`,
              headers: rootHeaders,
              payload: {
                revision: 2,
                changes: {
                  earliest: Date.now() - 1000,
                  latest: Date.now() + 600000,
                },
                reason: "Explicitly revise expired unused practice window",
              },
            });
            expect(revised.statusCode, revised.body).toBe(200);
          }
          prepared = await preflight();
        }
        expect(prepared.statusCode, prepared.body).toBe(200);
        expect(prepared.json().id).not.toBe(id);
        ({ id, page } = prepared.json());
        expect(store.attempt(id).grant_id).toBe(grantID);
      }
      expect(
        store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
      ).toEqual({ n: scenario === "revoked" ? 2 : 1 });
      await freshCapture(app, id, page, headers);
      const begin = () =>
        app.inject({
          method: "POST",
          url: `/api/student/attempts/${id}/begin`,
          headers: { ...headers, "x-page-instance": page },
          payload: {
            screen: true,
            keyboard: true,
            fullscreen: true,
            focus: true,
            visible: true,
            webcam: false,
          },
        });
      const started = await begin();
      expect(started.statusCode, started.body).toBe(200);
      const before = store.attempt(id);
      expect(before.deadline! - before.start!).toBe(300000);
      expect(before.original_deadline).toBe(before.deadline);
      if (scenario === "first") {
        const selected = definitions.show("sandbox");
        definitions.update(
          "sandbox",
          { earliest: Date.now() - 120000, latest: Date.now() - 60000 },
          selected.revision,
          "instructor",
          "Close future defaults without revising active practice",
        );
        expect(store.attempt(id)).toEqual(before);
      }
      expect((await begin()).statusCode).toBe(200);
      expect(store.attempt(id).start).toBe(before.start);
      expect(agreements).toBe(1);
      expect(
        store.db
          .prepare("SELECT status FROM attempt_grants WHERE id=?")
          .get(grantID),
      ).toEqual({ status: "CONSUMED" });
      if (scenario.startsWith("repeat")) {
        const finish = await app.inject({
          method: "POST",
          url: `/api/student/attempts/${id}/finish`,
          headers: { ...headers, "x-page-instance": page },
          payload: {},
        });
        expect(finish.statusCode, finish.body).toBe(200);
        expect(store.attempt(id)).toMatchObject({
          state: "COMPLETED",
          protected: 1,
          access_state: "HELD",
          start: before.start,
          original_deadline: before.original_deadline,
        });
        await expect(login()).rejects.toThrow(
          "completed exam still restricts server access",
        );
        expect(
          store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
        ).toEqual({ n: 1 });
        // Native access/expiry is a controlled dependency here (its real hold
        // enforcement is covered separately). Neither gateway elapsed time nor
        // transport loss grants release: require the actual signed callback.
        // Keep protocol UTC real across the isolated SSH worker process.
        const source = native.get(id);
        source.access_state = "RELEASED";
        const receipt = Buffer.from(
          JSON.stringify({
            agent: "class",
            sequence: 1,
            at: Date.now(),
            attempt: { ...source },
            manifest: manifests.get(id),
          }),
        );
        const accepted = await app.inject({
          method: "POST",
          url: "/api/agent/events",
          headers: {
            "content-type": "application/vnd.ssh-exam-event",
            "x-exam-signature": sign(null, receipt, h.callbackKey).toString(
              "base64",
            ),
          },
          payload: receipt,
        });
        expect(accepted.statusCode, accepted.body).toBe(200);
        headers = await login();
        if (scenario === "repeat-contradictory-claim")
          store.db
            .prepare("UPDATE grant_claims SET hash=? WHERE grant_id=?")
            .run("f".repeat(64), grantID);
        const next = await preflight();
        if (scenario === "repeat-contradictory-claim") {
          expect(next.statusCode, next.body).toBe(409);
          expect(next.body).toContain("Previous practice consumption");
          expect(
            store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
          ).toEqual({ n: 1 });
        } else {
          expect(next.statusCode, next.body).toBe(200);
          expect(next.json().id).not.toBe(id);
          const second = store.attempt(next.json().id);
          expect(second.grant_id).not.toBe(grantID);
          expect(second).toMatchObject({
            grant_kind: "PRACTICE",
            start: null,
            deadline: null,
          });
          expect(
            store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
          ).toEqual({ n: 2 });
        }
        expect(store.attempt(id)).toMatchObject({
          state: "COMPLETED",
          protected: 1,
          start: before.start,
          deadline: before.deadline,
          original_deadline: before.original_deadline,
        });
      }
    } finally {
      for (const ws of sockets) ws.close();
      await app.close();
      await h.close();
      rmSync(data, { recursive: true, force: true });
    }
  },
  45000,
);
