import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { createApp } from "../../apps/server/src/app.js";
import { hash } from "../../apps/server/src/db.js";
import { RosterManagement } from "../../apps/server/src/roster-management.js";
import { hosts } from "../fixtures/hosts.js";
import { freshCapture } from "../fixtures/fresh-capture.js";

it.each([
  "override",
  "inherit",
  "default-only",
  "lost-reply",
  "old-role",
  "prepared",
  "missing-after-receipt",
  "wrong-reply",
  "changed-during-query",
])(
  "explicit recovery allowance synchronization through settings, signed SSH preflight and Begin (%s)",
  async (scenario) => {
    const h = await hosts();
    const data = mkdtempSync(tmpdir() + "/recovery-allowance-");
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
    const { app, store } = await createApp(config);
    const source = {
      source_attempt: "11111111-1234-4234-8234-123456789abc",
      checksum: "a".repeat(64),
      created_at: Date.now() - 10000,
    };
    const grant: any = {
      ...source,
      duration: 3600,
      allowance_revision: null,
      consumed: false,
    };
    const digest = () => hash(JSON.stringify(grant));
    const operations: string[] = [];
    let remote: any,
      available = true,
      lost = false,
      changed = false;
    h.control.command = async (op, body) => {
      operations.push(op);
      if (op === "register") return { uid: 10001 };
      if (op === "resolve-course-accounts") return { student: 10001 };
      if (op === "health")
        return {
          ready: true,
          fixture: true,
          capabilities: [
            "private-workspace-staging",
            ...(scenario === "old-role" ? [] : ["recovery-allowance-sync-v1"]),
          ],
        };
      if (op === "reconcile-recovery-allowance") {
        if (scenario === "prepared")
          throw Error(
            "recovery grant already prepared or started; cancel only a confirmed unstarted preparation",
          );
        if (!available) return { version: 1, recovery: null };
        if (body.allowance_edit) {
          expect(body.allowance_edit.actor).toContain("instructor");
          grant.duration = body.allowance_edit.duration;
          grant.allowance_revision = body.allowance_edit;
        }
        if (scenario === "lost-reply" && !lost) {
          lost = true;
          throw Error(
            "Synthetic reconciliation reply lost after native publication",
          );
        }
        if (scenario === "changed-during-query" && !changed) {
          changed = true;
          new RosterManagement(store).settings(
            "recovery",
            { usernames: ["student"], duration: 5400 },
            "second-instructor",
          );
        }
        return {
          version: 1,
          recovery: {
            version: 1,
            exam: "recovery",
            username: "student",
            uid: scenario === "wrong-reply" ? 10002 : 10001,
            duration: grant.duration,
            ...source,
            grant_hash: digest(),
            allowance_revision: grant.allowance_revision,
          },
        };
      }
      if (op === "prepare-recovery-attempt") {
        if (scenario === "missing-after-receipt") {
          available = false;
          throw Error(
            "Expected saved-work grant missing; no starter-file fallback",
          );
        }
        expect(body.expected_recovery).toBe(digest());
        expect(body.settings.duration).toBe(grant.duration);
        remote = {
          ...body,
          state: "PREPARING",
          start: 0,
          deadline: 0,
          original_deadline: 0,
        };
        return { ...remote };
      }
      if (op === "prepare-attempt")
        throw Error("Recovery silently used legacy/template preparation");
      if (op === "prepare-workspace") {
        expect(grant.consumed).toBe(false);
        remote.workspace = {
          version: 1,
          attempt: body.id,
          source: {
            kind: "saved",
            attempt: source.source_attempt,
            checksum: source.checksum,
          },
        };
        return { ...remote };
      }
      if (op === "inspect-attempt") {
        if (!remote) throw Error("attempt owner mismatch");
        return { ...remote };
      }
      if (op === "cancel-attempt") {
        remote = {
          ...body,
          state: "CANCELLED_BEFORE_START",
          start: 0,
          deadline: 0,
          original_deadline: 0,
          ended: Date.now(),
          policy_state: "NORMAL",
        };
        return { ...remote };
      }
      if (op === "activate-recovery-attempt") {
        expect(body.expected_recovery).toBe(remote.expected_recovery);
        expect(body.settings).toEqual(remote.settings);
        expect(remote.workspace.source).toEqual({
          kind: "saved",
          attempt: source.source_attempt,
          checksum: source.checksum,
        });
        expect(grant.consumed).toBe(false);
        const start = Date.now();
        grant.consumed = true;
        Object.assign(remote, {
          state: "ACTIVE",
          start,
          deadline: start + grant.duration * 1000,
          original_deadline: start + grant.duration * 1000,
          access_state: "HELD",
          work_path: "/work",
        });
        return { ...remote };
      }
      if (op === "lock-attempt") {
        remote.state = "LOCKED";
        return { ...remote };
      }
      throw Error("Unexpected synthetic operation " + op);
    };
    const sockets: WebSocket[] = [];
    try {
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      config.origin = origin;
      const definition = {
        id: "recovery",
        name: "Synthetic recovery",
        duration: 4500,
        webcam: false,
        template: "v1",
        terminals: 2,
        earliest: Date.now() - 60000,
        latest: Date.now() + 600000,
      };
      store.db
        .prepare("INSERT INTO exams VALUES('recovery',?)")
        .run(JSON.stringify(definition));
      store.db
        .prepare(
          "INSERT INTO enrollments(exam,username,uid,duration) VALUES('recovery','student',0,?)",
        )
        .run(scenario === "default-only" ? null : 3600);
      const admin = store.session("admin", "fixture-instructor", null);
      if (scenario !== "default-only") {
        const edit = await app.inject({
          method: "POST",
          url: "/api/admin/exams/recovery/roster/settings",
          headers: {
            origin,
            cookie: `session=${admin.token}`,
            "x-csrf-token": admin.csrf,
          },
          payload: {
            usernames: ["student"],
            duration: scenario === "inherit" ? null : 4500,
          },
        });
        expect(edit.statusCode, edit.body).toBe(200);
        expect(
          new RosterManagement(store).allowanceEdit("recovery", "student"),
        ).toMatchObject({ duration: 4500, actor: "fixture-instructor" });
        if (scenario === "inherit")
          store.db
            .prepare("UPDATE exams SET config=? WHERE id='recovery'")
            .run(JSON.stringify({ ...definition, duration: 5400 }));
      }
      const login = async () => {
        const auth = await app.inject({
          method: "POST",
          url: "/api/auth/start",
          headers: { origin },
          payload: {},
        });
        const cookie = String(auth.headers["set-cookie"]).split(";")[0];
        const ws = new WebSocket(
          origin.replace("http:", "ws:") + "/api/auth/dialogue",
          { headers: { origin, cookie } },
        );
        sockets.push(ws);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("Synthetic recovery SSH sign-in timed out")),
            10000,
          );
          const done = (error?: Error) => {
            clearTimeout(timer);
            error ? reject(error) : resolve();
          };
          ws.on("open", () =>
            ws.send(
              JSON.stringify({
                v: 1,
                type: "start",
                exam: "recovery",
                username: "student",
              }),
            ),
          );
          ws.on("error", done);
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
            if (m.type === "authenticated") done();
            if (m.type === "error") done(Error(m.error));
          });
        });
        const complete = await app.inject({
          method: "POST",
          url: "/api/auth/complete",
          headers: { origin, cookie },
          payload: {},
        });
        expect(complete.statusCode, complete.body).toBe(200);
        const cookies = complete.headers["set-cookie"];
        const sessionCookie = (
          Array.isArray(cookies) ? cookies : [String(cookies)]
        )
          .find((c) => c.startsWith("session="))!
          .split(";")[0];
        const session = await app.inject({
          url: "/api/session",
          headers: { cookie: sessionCookie },
        });
        return {
          origin,
          cookie: sessionCookie,
          "x-csrf-token": session.json().csrf,
        };
      };
      let headers = await login();
      const preflight = () =>
        app.inject({
          method: "POST",
          url: "/api/student/preflight",
          headers,
          payload: {},
        });
      let prepared = await preflight();
      if (["old-role", "prepared", "wrong-reply"].includes(scenario)) {
        expect(prepared.statusCode, prepared.body).toBe(400);
        expect(operations).not.toContain("prepare-recovery-attempt");
        expect(
          store.db.prepare("SELECT count(*) n FROM attempts").get(),
        ).toEqual({ n: 0 });
        expect(grant.consumed).toBe(false);
        if (scenario !== "wrong-reply") expect(grant.duration).toBe(3600);
        return;
      }
      if (["lost-reply", "changed-during-query"].includes(scenario)) {
        expect(prepared.statusCode, prepared.body).toBe(400);
        expect(
          store.db.prepare("SELECT count(*) n FROM attempts").get(),
        ).toEqual({ n: 0 });
        expect(grant.consumed).toBe(false);
        prepared = await preflight();
      }
      if (scenario === "missing-after-receipt") {
        expect(prepared.statusCode, prepared.body).toBe(400);
        expect(prepared.json().error).toContain(
          "Expected saved-work grant missing",
        );
        expect(
          store.db
            .prepare("SELECT count(*) n FROM recovery_grant_sources")
            .get(),
        ).toEqual({ n: 1 });
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
        headers = await login();
        const retry = await preflight();
        expect(retry.statusCode, retry.body).toBe(400);
        expect(retry.json().error).toContain(
          "starter-file fallback is forbidden",
        );
        expect(operations).not.toContain("prepare-attempt");
        expect(grant.consumed).toBe(false);
        expect(
          store.db.prepare("SELECT count(*) n FROM attempts").get(),
        ).toEqual({ n: 0 });
        return;
      }
      expect(prepared.statusCode, prepared.body).toBe(200);
      const id = prepared.json().id,
        page = prepared.json().page;
      expect(store.attempt(id)).toMatchObject({
        state: "PREPARING",
        start: null,
        deadline: null,
        original_deadline: null,
      });
      expect(JSON.parse(store.attempt(id).settings).duration).toBe(
        scenario === "default-only"
          ? 3600
          : scenario === "changed-during-query"
            ? 5400
            : 4500,
      );
      expect(grant.consumed).toBe(false);
      expect(remote.workspace.source.attempt).toBe(source.source_attempt);
      await freshCapture(app, id, page, headers);
      const begin = await app.inject({
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
      expect(begin.statusCode, begin.body).toBe(200);
      expect(store.attempt(id).deadline! - store.attempt(id).start!).toBe(
        grant.duration * 1000,
      );
      expect(grant.consumed).toBe(true);
      expect({
        source_attempt: grant.source_attempt,
        checksum: grant.checksum,
        created_at: grant.created_at,
      }).toEqual(source);
    } finally {
      for (const ws of sockets) ws.terminate();
      await app.close();
      await h.close();
      rmSync(data, { recursive: true, force: true });
    }
  },
);
