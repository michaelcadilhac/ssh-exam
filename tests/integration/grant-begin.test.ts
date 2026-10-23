import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomBytes, randomUUID, sign, verify } from "node:crypto";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { createApp } from "../../apps/server/src/app.js";
import { hash } from "../../apps/server/src/db.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";
import { hosts } from "../fixtures/hosts.js";

it.each([
  "ordinary",
  "outbound-unavailable",
  "wrong-native-uid",
  "cancelled-retry",
  "cancelled-consumption-contradiction",
  "cancelled-wrong-proof",
  "preflight-before-window",
  "cancelled-uid-change",
])(
  "new enrollment → signed SSH preparation → fresh authenticated grant Begin (%s)",
  async (scenario) => {
    const h = await hosts(),
      data = mkdtempSync(tmpdir() + "/grant-begin-");
    const config = {
      mode: "development" as const,
      origin: "http://127.0.0.1",
      port: 0,
      data,
      jump: h.jump,
      class: h.class,
      agent: h.agentConfig,
      maintenance: false,
    };
    const { app, store } = await createApp(config),
      native = new Map<string, any>();
    const sockets: WebSocket[] = [],
      operations: string[] = [],
      intents: string[] = [];
    let failed = false,
      verifiedUID = 10001;
    h.control.command = async (op, b) => {
      operations.push(op);
      if (op === "register") return { uid: verifiedUID };
      if (op === "resolve-course-accounts") return { student: verifiedUID };
      if (op === "health")
        return {
          ready: true,
          fixture: true,
          capabilities: [
            "private-workspace-staging",
            "immutable-template-versions-v1",
            "exact-template-begin-v1",
            "unified-initial-grants-v1",
          ],
        };
      if (op === "prepare-grant-attempt") {
        expect(b.grant).toMatchObject({
          revision: 1,
          hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
        const previous = native.get(b.id);
        if (previous)
          return scenario === "cancelled-wrong-proof" &&
            previous.state === "CANCELLED_BEFORE_START"
            ? { ...previous, id: "88888888-1234-4234-8234-123456789abc" }
            : { ...previous };
        const a = {
          ...b,
          state: "PREPARING",
          start: 0,
          deadline: 0,
          original_deadline: 0,
        };
        native.set(b.id, a);
        return { ...a };
      }
      const a = native.get(b.id);
      if (!a) throw Error("Unknown synthetic native attempt");
      if (op === "inspect-attempt")
        return scenario === "cancelled-wrong-proof" &&
          a.state === "CANCELLED_BEFORE_START"
          ? { ...a, id: "88888888-1234-4234-8234-123456789abc" }
          : { ...a };
      if (op === "prepare-workspace") {
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
        return { ...a };
      }
      if (op === "cancel-attempt") {
        expect(a.start).toBe(0);
        Object.assign(a, {
          state: "CANCELLED_BEFORE_START",
          policy_state: "NORMAL",
          ended: Date.now(),
        });
        return { ...a };
      }
      if (op === "activate-grant-attempt") {
        expect(b.grant).toEqual(a.grant);
        expect(b.settings).toEqual(a.settings);
        intents.push(b.grant_begin_intent);
        if (scenario === "outbound-unavailable" && !failed) {
          failed = true;
          throw Error(
            "Synthetic native outbound path unavailable before interval commit",
          );
        }
        const nonce = randomBytes(32).toString("hex"),
          boot = "77777777-1234-4234-8234-123456789abc";
        const request = {
          type: "grant-begin/v1",
          agent: "class",
          nonce,
          at: Date.now(),
          attempt: a.id,
          exam: a.exam,
          username: a.username,
          uid: 10001,
          grant: a.grant,
          intent: b.grant_begin_intent,
          transport: a.transport,
          boot,
          settings: a.settings,
        };
        if (scenario === "wrong-native-uid" && !failed) {
          failed = true;
          request.uid++;
        }
        const payload = Buffer.from(JSON.stringify(request));
        const response = await app.inject({
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
        if (request.uid !== 10001) {
          expect(response.statusCode).toBe(409);
          expect(a.start).toBe(0);
          throw Error("Synthetic wrong-UID fresh verification refused");
        }
        expect(response.statusCode, response.body).toBe(200);
        const frame = response.json(),
          signed = Buffer.from(frame.payload, "base64");
        expect(
          verify(
            null,
            signed,
            readFileSync(config.agent.signingKey),
            Buffer.from(frame.signature, "base64"),
          ),
        ).toBe(true);
        expect(JSON.parse(signed.toString())).toMatchObject({
          type: "grant-begin/v1",
          audience: "class",
          nonce,
          attempt: a.id,
          grant: a.grant,
          intent: b.grant_begin_intent,
          transport: a.transport,
          boot,
        });
        const start = Date.now();
        Object.assign(a, {
          state: "ACTIVE",
          start,
          deadline: start + a.settings.duration * 1000,
          original_deadline: start + a.settings.duration * 1000,
          grant_begin_intent: b.grant_begin_intent,
          access_state: "HELD",
          work_path: "/work",
        });
        return { ...a };
      }
      if (op === "lock-attempt") {
        a.state = "LOCKED";
        return { ...a };
      }
      throw Error("Unexpected legacy/alternate synthetic operation " + op);
    };
    try {
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      config.origin = origin;
      const digest = "a".repeat(64);
      new TemplateCatalog(store, "class").sync(
        {
          version: {
            schema: 1,
            name: "v1",
            hash: digest,
            entries: 4,
            files: 2,
            bytes: 30,
            max_file_bytes: 20,
            created: 1000,
          },
          reason: "Synthetic reviewed initial native grant source",
        },
        {
          agent: "class",
          actor: "agent:class:root",
          request: randomUUID(),
          issued: 1000,
          observed: 1001,
        },
      );
      const definition = {
        id: "ordinary",
        name: "Initial SSH grant",
        duration: 5400,
        webcam: true,
        template: "v1",
        template_version: digest,
        terminals: 2,
        earliest:
          scenario === "preflight-before-window"
            ? Date.now() + 60000
            : Date.now() - 60000,
        latest: Date.now() + 600000,
      };
      store.db
        .prepare("INSERT INTO exams VALUES('ordinary',?)")
        .run(JSON.stringify(definition));
      const admin = store.session("admin", "fixture-instructor", null),
        adminHeaders = {
          origin,
          cookie: `session=${admin.token}`,
          "x-csrf-token": admin.csrf,
        };
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/admin/exams/ordinary/roster/add",
            headers: adminHeaders,
            payload: { username: "student", duration: 7200, webcam: false },
          })
        ).statusCode,
      ).toBe(200);
      const issued = (
        await app.inject({
          url: "/api/admin/exams/ordinary/grants?username=student",
          headers: adminHeaders,
        })
      ).json().grants[0];
      store.db.prepare("UPDATE exams SET config=? WHERE id='ordinary'").run(
        JSON.stringify({
          ...definition,
          duration: 3600,
          webcam: true,
          latest: Date.now() - 1000,
        }),
      );
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/admin/exams/ordinary/roster/settings",
            headers: adminHeaders,
            payload: { usernames: ["student"], duration: 4500, webcam: true },
          })
        ).statusCode,
      ).toBe(200);
      const login = async () => {
        const auth = await app.inject({
            method: "POST",
            url: "/api/auth/start",
            headers: { origin },
            payload: {},
          }),
          cookie = String(auth.headers["set-cookie"]).split(";")[0];
        const ws = new WebSocket(
          origin.replace("http:", "ws:") + "/api/auth/dialogue",
          { headers: { origin, cookie } },
        );
        sockets.push(ws);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("Synthetic initial-grant SSH login timed out")),
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
                exam: "ordinary",
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
        const complete = await app.inject({
          method: "POST",
          url: "/api/auth/complete",
          headers: { origin, cookie },
          payload: {},
        });
        expect(complete.statusCode, complete.body).toBe(200);
        const cookies = complete.headers["set-cookie"],
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
        (await app.inject({ url: "/api/student/exam", headers })).json()
          .settings,
      ).toMatchObject({
        duration: 7200,
        webcam: false,
        latest: definition.latest,
      });
      const preflight = () =>
        app.inject({
          method: "POST",
          url: "/api/student/preflight",
          headers,
          payload: {},
        });
      let prepared = await preflight();
      expect(prepared.statusCode, prepared.body).toBe(200);
      if (
        [
          "cancelled-consumption-contradiction",
          "cancelled-wrong-proof",
        ].includes(scenario)
      ) {
        const { id, page } = prepared.json();
        store.db
          .prepare(
            "INSERT INTO frames VALUES('preserve',?,'screen',0,?,0,0,?,640,480,'synthetic')",
          )
          .run(id, hash(page), Date.now());
        if (scenario === "cancelled-consumption-contradiction") {
          // Deliberately contradictory restore-like intermediate evidence. A
          // native no-start response cannot erase this independent interval.
          store.db
            .prepare(
              "INSERT INTO grant_begin_intents(id,attempt,transport,state,created_at,start,deadline) VALUES(?,?,?,'CONSUMED',?,100,7200100)",
            )
            .run(randomUUID(), id, native.get(id).transport, Date.now());
        }
        await app.inject({
          method: "POST",
          url: "/api/logout",
          headers,
          payload: {},
        });
        expect(
          store.db
            .prepare("SELECT count(*) AS n FROM frames WHERE attempt=?")
            .get(id),
        ).toEqual({ n: 1 });
        expect(store.attempt(id)).toMatchObject({
          state: "PREPARING",
          start: null,
          deadline: null,
        });
        expect(
          store.db
            .prepare("SELECT state FROM grant_claims WHERE attempt=?")
            .get(id),
        ).toEqual({ state: "PREPARING" });
        headers = await login();
        const refused = await preflight();
        expect(refused.statusCode).toBe(
          scenario === "cancelled-consumption-contradiction" ? 409 : 400,
        );
        expect(
          store.db
            .prepare("SELECT count(*) AS n FROM frames WHERE attempt=?")
            .get(id),
        ).toEqual({ n: 1 });
        expect(native.get(id).start).toBe(0);
        return;
      }
      if (["cancelled-retry", "cancelled-uid-change"].includes(scenario)) {
        const old = prepared.json().id;
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
        if (scenario === "cancelled-uid-change") verifiedUID = 10002;
        headers = await login();
        prepared = await preflight();
        if (scenario === "cancelled-uid-change") {
          expect(prepared.statusCode, prepared.body).toBe(409);
          expect(prepared.json().error).toContain("Unix identity changed");
          expect(
            store.db
              .prepare("SELECT uid,state FROM grant_claims WHERE attempt=?")
              .get(old),
          ).toEqual({ uid: 10001, state: "CANCELLED" });
          expect(
            store.db.prepare("SELECT count(*) AS n FROM attempts").get(),
          ).toEqual({ n: 0 });
          return;
        }
        expect(prepared.statusCode, prepared.body).toBe(200);
        expect(prepared.json().id).not.toBe(old);
        expect(
          store.db
            .prepare("SELECT grant_id,state FROM grant_claims WHERE attempt=?")
            .get(old),
        ).toEqual({ grant_id: issued.id, state: "CANCELLED" });
        expect(() => store.attempt(old)).toThrow("Attempt not found");
      }
      const { id, page, settings } = prepared.json();
      expect(settings).toMatchObject({
        duration: 7200,
        webcam: false,
        template_version: digest,
      });
      expect(store.attempt(id)).toMatchObject({
        grant_id: issued.id,
        grant_revision: 1,
        grant_hash: issued.hash,
        state: "PREPARING",
        start: null,
        deadline: null,
      });
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/admin/grants/${issued.id}/revoke`,
            headers: adminHeaders,
            payload: {
              revision: 1,
              reason: "Refuse withdrawing a prepared grant",
              request: randomUUID(),
            },
          })
        ).statusCode,
      ).toBe(409);
      store.db
        .prepare(
          "INSERT INTO frames VALUES('f',?,'screen',0,?,0,0,?,640,480,'synthetic')",
        )
        .run(id, hash(page), Date.now());
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
      if (scenario === "preflight-before-window") {
        const refused = await begin();
        expect(refused.statusCode, refused.body).toBe(400);
        expect(refused.json().error).toContain("Outside allowed start window");
        expect(store.attempt(id)).toMatchObject({
          state: "PREPARING",
          start: null,
          grant_begin_intent: null,
        });
        expect(operations).not.toContain("activate-grant-attempt");
        return;
      }
      if (["outbound-unavailable", "wrong-native-uid"].includes(scenario)) {
        const refused = await begin();
        expect(refused.statusCode, refused.body).toBe(400);
        expect(store.attempt(id)).toMatchObject({
          state: "PREPARING",
          start: null,
          deadline: null,
          grant_begin_intent: expect.any(String),
        });
        expect(native.get(id).start).toBe(0);
        expect(
          store.db
            .prepare("SELECT status FROM attempt_grants WHERE id=?")
            .get(issued.id),
        ).toEqual({ status: "AVAILABLE" });
      }
      const actual = Date.now(),
        active = await begin();
      expect(active.statusCode, active.body).toBe(200);
      expect(store.attempt(id).start!).toBeGreaterThanOrEqual(actual);
      expect(store.attempt(id).deadline! - store.attempt(id).start!).toBe(
        7200000,
      );
      expect(
        store.db
          .prepare("SELECT status FROM attempt_grants WHERE id=?")
          .get(issued.id),
      ).toEqual({ status: "CONSUMED" });
      expect(new Set(intents).size).toBe(1);
      expect(
        store.db
          .prepare(
            "SELECT state,start,deadline FROM grant_begin_intents WHERE attempt=?",
          )
          .get(id),
      ).toMatchObject({
        state: "CONSUMED",
        start: store.attempt(id).start,
        deadline: store.attempt(id).original_deadline,
      });
      expect(operations).not.toContain("prepare-attempt");
      expect(operations).not.toContain("activate-attempt");
      expect(operations).not.toContain("reconcile-recovery-allowance");
    } finally {
      for (const ws of sockets) ws.terminate();
      await app.close();
      await h.close();
      rmSync(data, { recursive: true, force: true });
    }
  },
);
