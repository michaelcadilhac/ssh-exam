import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { createApp } from "../../apps/server/src/app.js";
import { hosts } from "../fixtures/hosts.js";
import { hash } from "../../apps/server/src/db.js";

it("secure-access setup stays unstarted and disconnects SSH only after the policy receipt", async () => {
  const h = await hosts();
  const dir = mkdtempSync(tmpdir() + "/temporary-access-");
  const config = {
    mode: "development" as const,
    origin: "http://127.0.0.1",
    port: 0,
    data: dir,
    jump: h.jump,
    class: h.class,
    agent: h.agentConfig,
    maintenance: false,
  };
  const { app, store } = await createApp(config);
  const operations: string[] = [];
  let remote: any;
  h.control.command = async (op, body) => {
    operations.push(op);
    if (op === "register") {
      expect(body.exam).toBe("e");
      return { uid: 10001 };
    }
    if (op === "resolve-course-accounts") return { student: 10001 };
    if (op === "inspect-attempt") return { ...remote };
    if (op === "prepare-account-policy")
      return {
        ...remote,
        policy_state: "READY",
        policy_expires: Date.now() + 300000,
      };
    throw Error("Unexpected fixture operation: " + op);
  };
  let ws: WebSocket | undefined;
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    config.origin = origin;
    const settings = {
      id: "e",
      duration: 5400,
      webcam: false,
      earliest: 0,
      latest: Date.now() + 600000,
      template: "test",
      terminals: 4,
    };
    store.db
      .prepare("INSERT INTO exams VALUES('e',?)")
      .run(JSON.stringify(settings));
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid) VALUES('e','student',0)",
      )
      .run();
    const start = await app.inject({
      method: "POST",
      url: "/api/auth/start",
      headers: { origin },
      payload: {},
    });
    const cookie = String(start.headers["set-cookie"]).split(";")[0];
    ws = new WebSocket(origin.replace("http:", "ws:") + "/api/auth/dialogue", {
      headers: { origin, cookie },
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Fixture sign-in timed out")),
        10000,
      );
      ws!.on("open", () =>
        ws!.send(
          JSON.stringify({
            v: 1,
            type: "start",
            exam: "e",
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
    expect(complete.statusCode).toBe(200);
    const cookies = complete.headers["set-cookie"];
    const sessionCookie = (Array.isArray(cookies) ? cookies : [String(cookies)])
      .find((c) => c.startsWith("session="))!
      .split(";")[0];
    const session = await app.inject({
      url: "/api/session",
      headers: { cookie: sessionCookie },
    });
    const page = "fixture-page";
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,page_hash,last_contact) VALUES('setup','e','student',10001,'PREPARING',?,?,?)",
      )
      .run(JSON.stringify(settings), hash(page), Date.now());
    store.db
      .prepare(
        "INSERT INTO frames VALUES('f','setup','screen',0,?,0,0,?,640,480,'fixture')",
      )
      .run(hash(page), Date.now());
    remote = {
      id: "setup",
      exam: "e",
      username: "student",
      uid: 10001,
      state: "PREPARING",
      start: 0,
      account_policy_required: true,
    };
    const headers = {
      origin,
      cookie: sessionCookie,
      "x-csrf-token": session.json().csrf,
      "x-page-instance": page,
    };
    const begun = await app.inject({
      method: "POST",
      url: "/api/student/attempts/setup/begin",
      headers,
      payload: {
        screen: true,
        keyboard: true,
        fullscreen: true,
        focus: true,
        visible: true,
        webcam: false,
      },
    });
    expect(begun.statusCode, begun.body).toBe(200);
    expect(begun.json().requiresReauthentication).toBe(true);
    expect(store.attempt("setup").start).toBeNull();
    expect(store.attempt("setup").deadline).toBeNull();
    expect(store.attempt("setup").policy_state).toBe("READY");
    expect(operations).not.toContain("activate-attempt");
    // The handoff asks the live authority again rather than trusting a delayed cached callback.
    const tooSoon = await app.inject({
      method: "POST",
      url: "/api/student/attempts/setup/secure-access-reauth",
      headers,
      payload: {},
    });
    expect(tooSoon.statusCode).toBe(400);
    remote.policy_state = "READY";
    const handoff = await app.inject({
      method: "POST",
      url: "/api/student/attempts/setup/secure-access-reauth",
      headers,
      payload: {},
    });
    expect(handoff.statusCode, handoff.body).toBe(200);
    expect(store.attempt("setup").state).toBe("PREPARING");
    expect(store.attempt("setup").start).toBeNull();
  } finally {
    ws?.close();
    await app.close();
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);
