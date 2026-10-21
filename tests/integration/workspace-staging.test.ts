import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { createApp } from "../../apps/server/src/app.js";
import { hosts } from "../fixtures/hosts.js";
import { hash } from "../../apps/server/src/db.js";

it("signed SSH preflight retries a lost staging acknowledgment without consuming time; only explicit Begin starts", async () => {
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
    lost = false;
  h.control.command = async (op, body) => {
    operations.push(op);
    if (op === "register") return { uid: 10001 };
    if (op === "resolve-course-accounts") return { student: 10001 };
    if (op === "health")
      return {
        ready: true,
        fixture: true,
        capabilities: ["private-workspace-staging"],
      };
    if (op === "prepare-attempt") {
      expect(body.settings.collection_file_mib).toBe(128);
      expect(body.settings.collection_total_mib).toBe(512);
      remote ??= { ...body, state: "PREPARING", start: 0, deadline: 0 };
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
    if (op === "activate-attempt") {
      expect(staged).toBe(true);
      expect(operations.filter((x) => x === "prepare-workspace")).toHaveLength(
        2,
      );
      Object.assign(remote, {
        state: "ACTIVE",
        start: Date.now(),
        deadline: Date.now() + 5400000,
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
  let ws: WebSocket | undefined;
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    config.origin = origin;
    store.db.prepare("INSERT INTO exams VALUES('e',?)").run(
      JSON.stringify({
        id: "e",
        duration: 5400,
        webcam: false,
        earliest: Date.now() - 60000,
        latest: Date.now() + 600000,
        template: "v1",
        terminals: 4,
      }),
    );
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid) VALUES('e','student',0)",
      )
      .run();
    const auth = await app.inject({
      method: "POST",
      url: "/api/auth/start",
      headers: { origin },
      payload: {},
    });
    const cookie = String(auth.headers["set-cookie"]).split(";")[0];
    ws = new WebSocket(origin.replace("http:", "ws:") + "/api/auth/dialogue", {
      headers: { origin, cookie },
    });
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
    expect(complete.statusCode, complete.body).toBe(200);
    const cookies = complete.headers["set-cookie"];
    const sessionCookie = (Array.isArray(cookies) ? cookies : [String(cookies)])
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
    expect(operations.filter((x) => x === "activate-attempt")).toHaveLength(1);
  } finally {
    ws?.close();
    await app.close();
    await h.close();
    rmSync(data, { recursive: true, force: true });
  }
}, 20000);
