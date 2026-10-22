import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { createApp } from "../../apps/server/src/app.js";
import { hosts } from "../fixtures/hosts.js";
import { hash } from "../../apps/server/src/db.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";

it.each(["e", "sandbox", "versioned"])(
  "%s signed SSH preflight retries a lost staging acknowledgment without consuming time; only explicit Begin starts",
  async (examID) => {
    const versioned = examID === "versioned",
      sourceHash = "a".repeat(64);
    const h = await hosts();
    const data = mkdtempSync(tmpdir() + "/workspace-stage-");
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
    const operations: string[] = [];
    let remote: any,
      staged = false,
      lost = false,
      legacyAgent = false,
      legacyTemplateAgent = false,
      wrongPreparation = "";
    let holdHealth: { entered: () => void; release: Promise<void> } | null =
      null;
    h.control.command = async (op, body) => {
      operations.push(op);
      if (op === "register") return { uid: 10001 };
      if (op === "resolve-course-accounts") return { student: 10001 };
      if (op === "health") {
        if (holdHealth) {
          const gate = holdHealth;
          holdHealth = null;
          gate.entered();
          await gate.release;
        }
        return {
          ready: true,
          fixture: !legacyAgent,
          capabilities: [
            "private-workspace-staging",
            ...(versioned && !legacyTemplateAgent
              ? ["immutable-template-versions-v1", "exact-template-begin-v1"]
              : []),
          ],
        };
      }
      if (op === "prepare-attempt") {
        expect(body.settings.collection_file_mib).toBe(128);
        expect(body.settings.collection_total_mib).toBe(512);
        if (versioned) expect(body.settings.template_version).toBe(sourceHash);
        remote ??= { ...body, state: "PREPARING", start: 0, deadline: 0 };
        if (wrongPreparation === "missing-version")
          return {
            ...remote,
            settings: { ...remote.settings, template_version: undefined },
          };
        if (wrongPreparation === "wrong-id")
          return { ...remote, id: randomUUID() };
        if (wrongPreparation === "wrong-uid") return { ...remote, uid: 10002 };
        return { ...remote };
      }
      if (op === "prepare-workspace") {
        expect(store.attempt(body.id).start).toBeNull();
        expect(remote.start).toBe(0);
        staged = true;
        remote.workspace = { version: 1, attempt: body.id };
        if (!lost) {
          lost = true;
          throw Error(
            "Synthetic staging reply lost after private publication; retry preflight",
          );
        }
        return { ...remote };
      }
      if (op === "inspect-attempt") return { ...remote };
      if (op === "activate-attempt" || op === "activate-versioned-attempt") {
        if (versioned) {
          expect(op).toBe("activate-versioned-attempt");
          expect(body.settings).toEqual(remote.settings);
        } else expect(op).toBe("activate-attempt");
        expect(staged).toBe(true);
        expect(
          operations.filter((x) => x === "prepare-workspace"),
        ).toHaveLength(2);
        Object.assign(remote, {
          state: "ACTIVE",
          start: Date.now(),
          deadline: Date.now() + remote.settings.duration * 1000,
          access_state: "HELD",
          work_path: "/work",
        });
        return { ...remote };
      }
      if (op === "lock-attempt") {
        remote.state = "LOCKED";
        return { ...remote };
      }
      if (op === "issue-channel-admission")
        throw Error("Synthetic setup failure: Page cache owns a busy filename");
      throw Error("Unexpected synthetic operation " + op);
    };
    let ws: WebSocket | undefined,
      terminalWS: WebSocket | undefined,
      badWS: WebSocket | undefined;
    try {
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      config.origin = origin;
      const definition = {
        id: examID,
        duration: 5400,
        webcam: false,
        earliest: Date.now() - 60000,
        latest: Date.now() + 600000,
        template: "v1",
        terminals: 4,
      };
      if (examID === "sandbox") {
        // Exercise the supported shared operator writer, not a magic test-only
        // rolling default. New installs intentionally have no open practice.
        const definitions = new ExamDefinitions(store);
        definitions.update(
          examID,
          { earliest: definition.earliest, latest: definition.latest },
          definitions.show(examID).revision,
          "fixture-operator",
          "Configure finite synthetic practice window",
        );
      } else if (versioned) {
        const catalog = new TemplateCatalog(store, config.agent.id);
        catalog.sync(
          {
            version: {
              schema: 1,
              name: "v1",
              hash: sourceHash,
              entries: 4,
              files: 2,
              bytes: 30,
              max_file_bytes: 20,
              created: 1000,
            },
            reason: "Reviewed synthetic immutable source",
          },
          {
            agent: config.agent.id,
            actor: `agent:${config.agent.id}:root`,
            request: randomUUID(),
            issued: Date.now(),
            observed: Date.now(),
          },
        );
        new ExamDefinitions(store, config.agent.id).create(
          {
            ...definition,
            name: "Versioned exam",
            template_version: sourceHash,
          },
          "fixture-operator",
        );
      } else
        store.db
          .prepare("INSERT INTO exams VALUES(?,?)")
          .run(examID, JSON.stringify(definition));
      store.db
        .prepare(
          "INSERT INTO enrollments(exam,username,uid) VALUES(?,'student',0)",
        )
        .run(examID);
      const auth = await app.inject({
        method: "POST",
        url: "/api/auth/start",
        headers: { origin },
        payload: {},
      });
      const cookie = String(auth.headers["set-cookie"]).split(";")[0];
      ws = new WebSocket(
        origin.replace("http:", "ws:") + "/api/auth/dialogue",
        {
          headers: { origin, cookie },
        },
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Synthetic SSH sign-in timed out")),
          10000,
        );
        ws!.on("open", () =>
          ws!.send(
            JSON.stringify({
              v: 1,
              type: "start",
              exam: examID,
              username: "student",
            }),
          ),
        );
        ws!.on("error", reject);
        ws!.on("message", (data) => {
          const m = JSON.parse(data.toString());
          if (m.type === "challenge" && m.prompts.length)
            ws!.send(
              JSON.stringify({
                v: 1,
                type: "answers",
                round: m.round,
                answers: m.prompts.map(() => "shared-password"),
              }),
            );
          if (m.type === "authenticated") {
            clearTimeout(timer);
            resolve();
          }
          if (m.type === "error") {
            clearTimeout(timer);
            reject(Error(m.error));
          }
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
      const headers = {
        origin,
        cookie: sessionCookie,
        "x-csrf-token": session.json().csrf,
      };
      if (examID === "sandbox") {
        legacyAgent = true;
        const oldAgent = await app.inject({
          method: "POST",
          url: "/api/student/preflight",
          headers,
          payload: {},
        });
        expect(oldAgent.statusCode, oldAgent.body).toBe(400);
        expect(oldAgent.json().error).toContain("lacks finite sandbox");
        expect(operations).not.toContain("prepare-attempt");
        legacyAgent = false;
        const definitions = new ExamDefinitions(store);
        const current = definitions.show(examID);
        definitions.update(
          examID,
          { earliest: Date.now() + 60000, latest: Date.now() + 120000 },
          current.revision,
          "fixture-operator",
          "Test closed finite synthetic practice window",
        );
        const closed = await app.inject({
          method: "POST",
          url: "/api/student/preflight",
          headers,
          payload: {},
        });
        expect(closed.statusCode, closed.body).toBe(400);
        expect(closed.json().error).toMatch(/window/i);
        expect(
          store.db.prepare("SELECT count(*) n FROM attempts").get(),
        ).toEqual({ n: 0 });
        expect(operations).not.toContain("prepare-attempt");
        definitions.update(
          examID,
          { earliest: definition.earliest, latest: definition.latest },
          definitions.show(examID).revision,
          "fixture-operator",
          "Reopen explicit synthetic practice window",
        );
      }
      if (versioned) {
        legacyTemplateAgent = true;
        const old = await app.inject({
          method: "POST",
          url: "/api/student/preflight",
          headers,
          payload: {},
        });
        expect(old.statusCode, old.body).toBe(400);
        expect(old.json().error).toContain("lacks exact-template");
        expect(operations).not.toContain("prepare-attempt");
        expect(
          store.db.prepare("SELECT count(*) n FROM attempts").get(),
        ).toEqual({ n: 0 });
        legacyTemplateAgent = false;
        for (const fault of ["missing-version", "wrong-id", "wrong-uid"]) {
          wrongPreparation = fault;
          const wrong = await app.inject({
            method: "POST",
            url: "/api/student/preflight",
            headers,
            payload: {},
          });
          expect(wrong.statusCode, wrong.body).toBe(400);
          expect(wrong.json().error).toContain("did not retain");
          expect(operations).not.toContain("prepare-workspace");
          expect(store.attempt(remote.id).start).toBeNull();
        }
        wrongPreparation = "";
      }
      const failed = await app.inject({
        method: "POST",
        url: "/api/student/preflight",
        headers,
        payload: {},
      });
      expect(failed.statusCode).toBe(400);
      expect(failed.json().error).toContain("staging reply lost");
      const id = remote.id;
      expect(store.attempt(id)).toMatchObject({
        state: "PREPARING",
        start: null,
        deadline: null,
        original_deadline: null,
      });
      expect(operations).not.toContain("activate-attempt");
      expect(operations).not.toContain("activate-versioned-attempt");
      if (versioned) {
        const nextHash = "b".repeat(64),
          catalog = new TemplateCatalog(store, config.agent.id);
        catalog.sync(
          {
            version: {
              schema: 1,
              name: "v1",
              hash: nextHash,
              entries: 4,
              files: 2,
              bytes: 30,
              max_file_bytes: 20,
              created: 1000,
            },
            reason: "Reviewed new synthetic immutable source",
          },
          {
            agent: config.agent.id,
            actor: `agent:${config.agent.id}:root`,
            request: randomUUID(),
            issued: Date.now(),
            observed: Date.now(),
          },
        );
        const definitions = new ExamDefinitions(store, config.agent.id);
        definitions.update(
          examID,
          { template_version: nextHash },
          definitions.show(examID).revision,
          "fixture-operator",
          "Change defaults without rewriting saved preparation",
        );
        expect(JSON.parse(store.attempt(id).settings).template_version).toBe(
          sourceHash,
        );
      }
      const retry = await app.inject({
        method: "POST",
        url: "/api/student/preflight",
        headers,
        payload: {},
      });
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json().id).toBe(id);
      expect(store.attempt(id).start).toBeNull();
      const page = retry.json().page;
      store.db
        .prepare(
          "INSERT INTO frames VALUES('f',?,'screen',0,?,0,0,?,640,480,'synthetic')",
        )
        .run(id, hash(page), Date.now());
      if (examID === "sandbox" || versioned) {
        legacyAgent = true;
        legacyTemplateAgent = true;
        const refused = await app.inject({
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
        expect(refused.statusCode, refused.body).toBe(400);
        expect(operations).not.toContain("activate-attempt");
        expect(operations).not.toContain("activate-versioned-attempt");
        expect(store.attempt(id)).toMatchObject({
          state: "PREPARING",
          start: null,
          deadline: null,
        });
        legacyAgent = false;
        legacyTemplateAgent = false;
      }
      if (versioned) {
        let entered!: () => void, release!: () => void;
        const seen = new Promise<void>((resolve) => (entered = resolve)),
          gate = new Promise<void>((resolve) => (release = resolve));
        holdHealth = { entered, release: gate };
        const pending = app.inject({
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
        let waitTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            seen,
            new Promise(
              (_, reject) =>
                (waitTimer = setTimeout(
                  () =>
                    reject(
                      Error("Begin did not reach scoped source-health wait"),
                    ),
                  3000,
                )),
            ),
          ]);
          store.db
            .prepare("UPDATE attempts SET page_hash=? WHERE id=?")
            .run(hash("synthetic-replacement-page"), id);
          release();
          const stale = await pending;
          expect(stale.statusCode, stale.body).toBe(400);
          expect(operations).not.toContain("activate-versioned-attempt");
          expect(remote.start).toBe(0);
          expect(store.attempt(id).start).toBeNull();
        } finally {
          clearTimeout(waitTimer);
          release();
          await pending;
          store.db
            .prepare("UPDATE attempts SET page_hash=? WHERE id=?")
            .run(hash(page), id);
        }
      }
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
      expect(store.attempt(id)).toMatchObject({
        state: "ACTIVE",
        start: remote.start,
        deadline: remote.deadline,
      });
      expect(
        operations.filter(
          (x) =>
            x ===
            (versioned ? "activate-versioned-attempt" : "activate-attempt"),
        ),
      ).toHaveLength(1);
      if (examID === "sandbox") {
        expect(remote.settings).toMatchObject({
          earliest: definition.earliest,
          latest: definition.latest,
          duration: 300,
          webcam: false,
        });
        expect(remote.deadline - remote.start).toBe(300000);
        const before = store.attempt(id);
        const definitions = new ExamDefinitions(store);
        definitions.update(
          examID,
          { earliest: Date.now() - 120000, latest: Date.now() - 60000 },
          definitions.show(examID).revision,
          "fixture-operator",
          "Close future practice without changing active clocks",
        );
        expect(store.attempt(id)).toEqual(before);
        const retried = await app.inject({
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
        expect(retried.statusCode, retried.body).toBe(200);
        expect(store.attempt(id).deadline).toBe(before.deadline);
        expect(operations.filter((x) => x === "activate-attempt")).toHaveLength(
          1,
        );
      }
      const connect = async () => {
        const socket = new WebSocket(
          origin.replace("http:", "ws:") + "/api/student/session",
          { headers: { origin, cookie: sessionCookie } },
        );
        await new Promise<void>((resolve, reject) => {
          socket.once("open", resolve);
          socket.once("error", reject);
        });
        return socket;
      };
      const exchange = (socket: WebSocket, payload: object) =>
        new Promise<any>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("Synthetic terminal WS reply timed out")),
            5000,
          );
          socket.once("message", (data) => {
            clearTimeout(timer);
            resolve(JSON.parse(data.toString()));
          });
          socket.send(JSON.stringify(payload));
        });
      badWS = await connect();
      const wrongPage = await exchange(badWS, {
        v: 1,
        type: "bind",
        attempt: id,
        page: "x".repeat(64),
      });
      expect(wrongPage).toMatchObject({
        type: "error",
        code: "page-ownership",
        error: "Page does not own attempt",
      });
      expect(store.attempt(id).state).toBe("ACTIVE");
      badWS.close();
      terminalWS = await connect();
      expect(
        (await exchange(terminalWS, { v: 1, type: "bind", attempt: id, page }))
          .type,
      ).toBe("state");
      const pane = randomUUID();
      const technical = await exchange(terminalWS, {
        v: 1,
        type: "open",
        pane,
      });
      expect(technical).toMatchObject({
        type: "error",
        pane,
        error: "Synthetic setup failure: Page cache owns a busy filename",
      });
      expect(technical.code).toBeUndefined();
      expect(store.attempt(id).state).toBe("ACTIVE");
    } finally {
      terminalWS?.close();
      badWS?.close();
      ws?.close();
      await app.close();
      await h.close();
      rmSync(data, { recursive: true, force: true });
    }
  },
  20000,
);
