import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { createApp } from "../../apps/server/src/app.js";
import { hosts } from "../fixtures/hosts.js";

it.each(["confirmed", "lost-cancel-reply", "unconfirmed"])(
  "rejected recovery preflight/logout remains safely retryable (%s)",
  async (outcome) => {
    const h = await hosts();
    const data = mkdtempSync(tmpdir() + "/recovery-admission-");
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
    let remote: any,
      rejectPreparation = true;
    const preparedIDs: string[] = [],
      cancelledIDs: string[] = [];
    const source = {
      source_attempt: "11111111-1234-1234-1234-123456789abc",
      checksum: "a".repeat(64),
    };
    const grant = { ...source, duration: 3600, consumed: false };
    h.control.command = async (op, body) => {
      if (op === "register") return { uid: 10001 };
      if (op === "resolve-course-accounts") return { student: 10001 };
      if (op === "health")
        return {
          ready: true,
          fixture: true,
          capabilities: ["private-workspace-staging"],
        };
      if (op === "prepare-attempt") {
        preparedIDs.push(body.id);
        expect(body.settings.duration).toBe(4500);
        if (rejectPreparation)
          throw Error(
            "recovery preparation does not match this student, exam or allowance",
          );
        remote = {
          ...body,
          state: "PREPARING",
          start: 0,
          deadline: 0,
          original_deadline: 0,
        };
        return { ...remote };
      }
      if (op === "cancel-attempt") {
        expect(body).toMatchObject({
          exam: "recovery",
          username: "student",
          uid: 10001,
          settings: { duration: 4500 },
        });
        expect(remote).toBeUndefined(); // The refused preparation never existed.
        cancelledIDs.push(body.id);
        if (outcome === "unconfirmed")
          throw Error("Synthetic cancellation transport failure");
        remote = {
          ...body,
          state: "CANCELLED_BEFORE_START",
          start: 0,
          deadline: 0,
          original_deadline: 0,
          ended: Date.now(),
          account_policy_required: true,
          policy_state: "NORMAL",
        };
        if (outcome === "lost-cancel-reply")
          throw Error("Synthetic cancellation reply lost after durable commit");
        return { ...remote };
      }
      if (op === "inspect-attempt") {
        if (!remote || body.id !== remote.id)
          throw Error("attempt owner mismatch");
        return { ...remote };
      }
      if (op === "prepare-workspace") {
        expect(grant.consumed).toBe(false);
        expect(remote.start).toBe(0);
        remote.workspace = { version: 1, attempt: body.id, ...source };
        return { ...remote };
      }
      throw Error("Unexpected synthetic operation " + op);
    };
    const sockets: WebSocket[] = [];
    try {
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      config.origin = origin;
      store.db
        .prepare("INSERT INTO exams VALUES('recovery',?)")
        .run(
          JSON.stringify({
            id: "recovery",
            duration: 3600,
            webcam: false,
            template: "v1",
            terminals: 2,
            earliest: Date.now() - 60000,
            latest: Date.now() + 600000,
          }),
        );
      store.db
        .prepare(
          "INSERT INTO enrollments(exam,username,uid,duration) VALUES('recovery','student',0,4500)",
        )
        .run();
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
            () => reject(Error("Synthetic SSH login timed out")),
            10000,
          );
          const settle = (error?: Error) => {
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
          ws.on("error", settle);
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
            if (m.type === "authenticated") settle();
            if (m.type === "error") settle(Error(m.error));
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
      const post = (url: string) =>
        app.inject({ method: "POST", url, headers, payload: {} });
      const refused = await post("/api/student/preflight");
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error).toContain("allowance");
      expect(preparedIDs).toHaveLength(1);
      const failedID = preparedIDs[0];
      expect(store.attempt(failedID)).toMatchObject({
        state: "PREPARING",
        start: null,
        deadline: null,
      });
      expect(remote).toBeUndefined();
      expect((await post("/api/logout")).statusCode).toBe(200);
      expect(cancelledIDs).toEqual([failedID]);
      expect(grant).toEqual({ ...source, duration: 3600, consumed: false });
      if (outcome === "unconfirmed") {
        expect(store.attempt(failedID)).toMatchObject({
          state: "PREPARING",
          start: null,
          deadline: null,
        });
        expect(
          store.db.prepare("SELECT count(*) n FROM attempts").get(),
        ).toEqual({ n: 1 });
        headers = await login();
        const uncertainRetry = await post("/api/student/preflight");
        expect(uncertainRetry.statusCode).toBe(400);
        expect(preparedIDs).toEqual([failedID, failedID]);
        expect(
          store.db.prepare("SELECT count(*) n FROM attempts").get(),
        ).toEqual({ n: 1 });
        expect(grant).toEqual({ ...source, duration: 3600, consumed: false });
        return;
      }
      expect(store.attempt(failedID).state).toBe("CANCELLED_BEFORE_START");
      expect(
        store.db
          .prepare(
            "SELECT count(*) n FROM outbox WHERE status='pending' AND subject LIKE 'Preflight cleanup pending:%'",
          )
          .get(),
      ).toEqual({ n: 0 });
      // Synthetic operator repair; real native allowance revision is qualified
      // separately. The cleanup regression must not weaken duration enforcement.
      grant.duration = 4500;
      rejectPreparation = false;
      headers = await login();
      const retry = await post("/api/student/preflight");
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json().id).not.toBe(failedID);
      expect(remote.workspace).toMatchObject(source);
      expect(store.attempt(retry.json().id)).toMatchObject({
        state: "PREPARING",
        start: null,
        deadline: null,
        original_deadline: null,
      });
      expect(grant).toEqual({ ...source, duration: 4500, consumed: false });
      expect(
        store.db
          .prepare("SELECT count(*) n FROM attempts WHERE id=?")
          .get(failedID),
      ).toEqual({ n: 0 });
    } finally {
      for (const ws of sockets) ws.terminate();
      await app.close();
      await h.close();
      rmSync(data, { recursive: true, force: true });
    }
  },
);
