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
  "reviewed-legacy",
  "reviewed-old-native",
  "additional-after-completed",
  "additional-empty",
  "additional-source-old-native",
  "additional-source-tamper",
  "additional-wrong-anchor",
  "old-ordered-role",
  "outbound-unavailable",
  "wrong-native-uid",
  "wrong-native-kind",
  "wrong-native-order",
  "cancelled-retry",
  "cancelled-consumption-contradiction",
  "cancelled-other-consumption",
  "cancelled-consumption-status",
  "cancelled-consumption-web-interval",
  "cancelled-consumption-protected",
  "cancelled-wrong-proof",
  "preflight-before-window",
  "cancelled-uid-change",
])(
  "new enrollment → signed SSH preparation → fresh authenticated grant Begin (%s)",
  async (scenario) => {
    const additional = scenario.startsWith("additional-"),
      allowance = additional ? 5400 : 7200;
    let priorHistory: any;
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
    let reviewedSupport = scenario !== "reviewed-old-native",
      orderedSupport = scenario !== "old-ordered-role",
      sourceSupport = scenario !== "additional-source-old-native";
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
            "verified-preflight-cancellation-v1",
            ...(orderedSupport ? ["ordered-template-grants-v1"] : []),
            ...(sourceSupport ? ["independent-workspace-grants-v1"] : []),
            ...(reviewedSupport ? ["reviewed-initial-grants-v1"] : []),
          ],
        };
      if (
        op === "prepare-grant-attempt" ||
        op === "prepare-additional-grant-attempt"
      ) {
        expect(b.grant.kind === "ADDITIONAL").toBe(
          op === "prepare-additional-grant-attempt",
        );
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
      if (op === "submission-manifest")
        return {
          attempt: { ...a },
          checksum: a.checksum,
          files: [],
          collected: a.deadline,
          secured: a.deadline,
        };
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
          source:
            a.grant.work?.kind === "empty"
              ? { kind: "empty" }
              : {
                  kind: "template",
                  template: a.settings.template,
                  version: a.settings.template_version,
                },
        };
        if (scenario === "additional-source-tamper" && !failed) {
          failed = true;
          a.workspace.source = {
            kind: "template",
            template: a.settings.template,
            version: a.settings.template_version,
          };
        }
        return { ...a };
      }
      if (op === "cancel-attempt") {
        expect(a.start).toBe(0);
        Object.assign(a, {
          state: "CANCELLED_BEFORE_START",
          policy_state: "NORMAL",
          cancellation_cleanup_complete: true,
          ended: Date.now(),
        });
        return { ...a };
      }
      if (
        op === "activate-grant-attempt" ||
        op === "activate-additional-grant-attempt"
      ) {
        expect(a.grant.kind === "ADDITIONAL").toBe(
          op === "activate-additional-grant-attempt",
        );
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
        if (scenario === "wrong-native-kind" && !failed) {
          failed = true;
          request.grant = { ...a.grant, kind: "ADDITIONAL" };
        }
        if (scenario === "wrong-native-order" && !failed) {
          failed = true;
          request.grant = {
            ...a.grant,
            issuance_order: a.grant.issuance_order + 1,
          };
        }
        if (scenario === "additional-wrong-anchor" && !failed) {
          failed = true;
          request.grant = {
            ...a.grant,
            initial_grant: "66666666-1234-4234-8234-123456789abc",
          };
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
        if (
          request.uid !== 10001 ||
          request.grant.kind !== a.grant.kind ||
          request.grant.issuance_order !== a.grant.issuance_order ||
          request.grant.initial_grant !== a.grant.initial_grant
        ) {
          expect(response.statusCode).toBe(409);
          expect(a.start).toBe(0);
          throw Error("Synthetic wrong-scope fresh verification refused");
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
      if (additional) {
        store.db
          .prepare(
            "INSERT INTO enrollments(exam,username,uid,duration,webcam) VALUES('ordinary','student',0,7200,0)",
          )
          .run();
        const historyID = "99999999-1234-4234-8234-123456789abc",
          start = Date.now() - 10800000;
        store.db
          .prepare(
            "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state) VALUES(?,'ordinary','student',10001,'COMPLETED',?,?,?,?,1,?,'RELEASED')",
          )
          .run(
            historyID,
            JSON.stringify(definition),
            start,
            start + 5400000,
            start + 5400000,
            "b".repeat(64),
          );
        priorHistory = store.attempt(historyID);
        native.set(historyID, {
          id: historyID,
          exam: "ordinary",
          username: "student",
          uid: 10001,
          state: "COMPLETED",
          settings: definition,
          start,
          deadline: start + 5400000,
          original_deadline: start + 5400000,
          protected: true,
          checksum: priorHistory.checksum,
          access_state: "RELEASED",
        });
        const review = await app.inject({
          method: "POST",
          url: "/api/admin/exams/ordinary/grants/additional-preview",
          headers: adminHeaders,
          payload: {
            definition_revision: hash(JSON.stringify(definition)),
            template_version: digest,
            earliest: definition.earliest,
            latest: definition.latest,
            usernames: ["student"],
            duration: allowance,
            ...(scenario === "additional-empty" ||
            scenario.startsWith("additional-source-")
              ? { work: { kind: "empty" } }
              : {}),
            reason:
              "Explicit separate additional allowance after completed attempt",
            request: randomUUID(),
          },
        });
        expect(review.statusCode, review.body).toBe(200);
        const confirmed = await app.inject({
          method: "POST",
          url: `/api/admin/grant-issuance/${review.json().id}/confirm`,
          headers: adminHeaders,
          payload: { revision: review.json().revision, request: randomUUID() },
        });
        expect(confirmed.statusCode, confirmed.body).toBe(200);
      } else if (scenario.startsWith("reviewed-")) {
        store.db
          .prepare(
            "INSERT INTO enrollments(exam,username,uid,duration,webcam) VALUES('ordinary','student',0,7200,0)",
          )
          .run();
        const reviewed = await app.inject({
          method: "POST",
          url: "/api/admin/exams/ordinary/grants/issue-preview",
          headers: adminHeaders,
          payload: {
            definition_revision: hash(JSON.stringify(definition)),
            template_version: digest,
            earliest: definition.earliest,
            latest: definition.latest,
            usernames: ["student"],
            reason: "Reviewed NEW initial authorization for legacy enrollment",
            request: randomUUID(),
          },
        });
        expect(reviewed.statusCode, reviewed.body).toBe(200);
        const confirmed = await app.inject({
          method: "POST",
          url: `/api/admin/grant-issuance/${reviewed.json().id}/confirm`,
          headers: adminHeaders,
          payload: {
            revision: reviewed.json().revision,
            request: randomUUID(),
          },
        });
        expect(confirmed.statusCode, confirmed.body).toBe(200);
        expect(
          store.db.prepare("SELECT count(*) n FROM attempts").get(),
        ).toEqual({ n: 0 });
      } else
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
        duration: allowance,
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
      if (scenario === "additional-source-old-native") {
        expect(prepared.statusCode).toBe(400);
        expect(prepared.body).toContain(
          "independent grant workspace enforcement",
        );
        expect(operations).not.toContain("prepare-additional-grant-attempt");
        expect(
          store.db
            .prepare("SELECT count(*) n FROM attempts WHERE state='PREPARING'")
            .get(),
        ).toEqual({ n: 0 });
        sourceSupport = true;
        prepared = await preflight();
      }
      if (scenario === "additional-source-tamper") {
        expect(prepared.statusCode).toBe(409);
        expect(prepared.body).toContain("workspace receipt differs");
        const row = store.db
          .prepare("SELECT * FROM attempts WHERE state='PREPARING'")
          .get() as any;
        expect(row).toMatchObject({
          start: null,
          deadline: null,
          grant_work: '{"kind":"empty"}',
        });
        expect(
          store.db
            .prepare("SELECT status FROM attempt_grants WHERE id=?")
            .get(issued.id),
        ).toEqual({ status: "AVAILABLE" });
        prepared = await preflight();
      }
      if (scenario === "old-ordered-role") {
        expect(prepared.statusCode).toBe(400);
        expect(prepared.body).toContain("ordered grant authority/type support");
        expect(
          store.db.prepare("SELECT count(*) n FROM attempts").get(),
        ).toEqual({ n: 0 });
        expect(operations).not.toContain("prepare-grant-attempt");
        orderedSupport = true;
        prepared = await preflight();
      }
      if (scenario === "reviewed-old-native") {
        expect(prepared.statusCode).toBe(400);
        expect(prepared.body).toContain(
          "reviewed-initial native history fences",
        );
        expect(
          store.db.prepare("SELECT count(*) n FROM attempts").get(),
        ).toEqual({ n: 0 });
        expect(operations).not.toContain("prepare-grant-attempt");
        reviewedSupport = true;
        prepared = await preflight();
      }
      expect(prepared.statusCode, prepared.body).toBe(200);
      if (
        [
          "cancelled-consumption-contradiction",
          "cancelled-other-consumption",
          "cancelled-consumption-status",
          "cancelled-consumption-web-interval",
          "cancelled-consumption-protected",
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
        if (scenario === "cancelled-other-consumption") {
          const other = randomUUID();
          store.db
            .prepare(
              "INSERT INTO grant_claims VALUES(?,?,1,?,10001,'CANCELLED',?,?)",
            )
            .run(other, issued.id, issued.hash, Date.now(), Date.now());
          store.db
            .prepare(
              "INSERT INTO grant_begin_intents(id,attempt,transport,state,created_at,start,deadline) VALUES(?,?,?,'CONSUMED',?,100,7200100)",
            )
            .run(randomUUID(), other, "retained-other-attempt", Date.now());
        }
        if (scenario === "cancelled-consumption-status") {
          store.db
            .prepare("UPDATE attempt_grants SET status='CONSUMED' WHERE id=?")
            .run(issued.id);
          expect(
            store.db
              .prepare("SELECT status FROM attempt_grants WHERE id=?")
              .get(issued.id),
          ).toEqual({ status: "CONSUMED" });
        }
        if (scenario === "cancelled-consumption-web-interval") {
          store.db
            .prepare("UPDATE attempts SET original_deadline=7200100 WHERE id=?")
            .run(id);
          expect(store.attempt(id).original_deadline).toBe(7200100);
        }
        if (scenario === "cancelled-consumption-protected") {
          store.db
            .prepare("UPDATE attempts SET protected=1,checksum=? WHERE id=?")
            .run(hash("retained protected source"), id);
          expect(store.attempt(id).protected).toBe(1);
        }
        if (
          [
            "cancelled-consumption-status",
            "cancelled-consumption-web-interval",
            "cancelled-consumption-protected",
          ].includes(scenario)
        )
          expect(
            store.db
              .prepare(
                "SELECT count(*) AS n FROM grant_begin_intents WHERE attempt=?",
              )
              .get(id),
          ).toEqual({ n: 0 });
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
          scenario.startsWith("cancelled-consumption") ||
            scenario === "cancelled-other-consumption"
            ? 409
            : 400,
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
      if (
        scenario === "additional-empty" ||
        scenario.startsWith("additional-source-")
      ) {
        expect(store.attempt(id).grant_work).toBe('{"kind":"empty"}');
        expect(() =>
          store.db
            .prepare("UPDATE attempts SET grant_work=NULL WHERE id=?")
            .run(id),
        ).toThrow("workspace source is immutable");
      }
      expect(settings).toMatchObject({
        duration: allowance,
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
      if (
        [
          "outbound-unavailable",
          "wrong-native-uid",
          "wrong-native-kind",
          "wrong-native-order",
          "additional-wrong-anchor",
        ].includes(scenario)
      ) {
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
        allowance * 1000,
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
      if (additional) {
        const old = store.attempt(priorHistory.id);
        for (const key of [
          "id",
          "exam",
          "username",
          "uid",
          "state",
          "settings",
          "start",
          "deadline",
          "original_deadline",
          "protected",
          "checksum",
        ])
          expect((old as any)[key], key).toEqual(priorHistory[key]);
        expect(old.id).not.toBe(id);
        expect(operations).toContain("prepare-additional-grant-attempt");
        expect(operations).toContain("activate-additional-grant-attempt");
      }
    } finally {
      for (const ws of sockets) ws.terminate();
      await app.close();
      await h.close();
      rmSync(data, { recursive: true, force: true });
    }
  },
);
