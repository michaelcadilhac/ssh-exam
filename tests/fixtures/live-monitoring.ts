import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import sharp from "sharp";
import WebSocket from "ws";
import { createApp } from "../../apps/server/src/app.js";
import { hash } from "../../apps/server/src/db.js";
import type { IsolatedConnection } from "../../apps/server/src/connection-process.js";
import { hosts } from "./hosts.js";

// Real authenticated SSH channels and HTTP/WebSocket interfaces; the SSH host's
// shell/native policy are simulated. This is not privileged freezer qualification.
export async function liveMonitoring() {
  const h = await hosts({ mfaDelayMs: 10 });
  h.control.command = async (op, body) => {
    if (op === "register") return {};
    if (op === "resolve-course-accounts") return { student: 10001 };
    return h.agent.call(op, body);
  };
  const data = mkdtempSync(tmpdir() + "/monitoring-liveness-");
  const config: any = {
    mode: "development",
    origin: "http://127.0.0.1",
    data,
    port: 0,
    jump: h.jump,
    class: h.class,
    agent: h.agentConfig,
    maintenance: false,
  };
  let connection: IsolatedConnection | undefined;
  const { app, store, life } = await createApp(config, {
    onConnection: (value) => {
      connection = value;
    },
    logStream: new Writable({
      write(_c, _e, done) {
        done();
      },
    }),
  });
  const sockets: WebSocket[] = [];
  const close = async () => {
    sockets.forEach((ws) => ws.terminate());
    await app.close();
    await h.close();
    rmSync(data, { recursive: true, force: true });
  };
  const open = (route: string, cookie: string) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(config.origin.replace("http:", "ws:") + route, {
        headers: { origin: config.origin, cookie },
      });
      sockets.push(ws);
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
  try {
    config.origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const exam = {
      id: "e",
      name: "Synthetic monitoring",
      duration: 5400,
      earliest: 0,
      latest: Date.now() + 86400000,
      template: "sample",
      terminals: 4,
      webcam: true,
    };
    store.db
      .prepare("INSERT INTO exams VALUES('e',?)")
      .run(JSON.stringify(exam));
    store.db.exec(
      "INSERT INTO enrollments VALUES('e','student',1,NULL,NULL,10001)",
    );
    const begun = await app.inject({
      method: "POST",
      url: "/api/auth/start",
      headers: { origin: config.origin },
      payload: {},
    });
    const dialogueCookie = String(begun.headers["set-cookie"]).split(";")[0];
    const auth = await open("/api/auth/dialogue", dialogueCookie);
    await new Promise<void>((resolve, reject) => {
      auth.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === "challenge" && m.prompts.length)
          auth.send(
            JSON.stringify({
              v: 1,
              type: "answers",
              round: m.round,
              answers: m.prompts.map(() => "shared-password"),
            }),
          );
        if (m.type === "authenticated") resolve();
        if (m.type === "error") reject(Error(m.error));
      });
      auth.send(
        JSON.stringify({ v: 1, type: "start", exam: "e", username: "student" }),
      );
    });
    const completed = await app.inject({
      method: "POST",
      url: "/api/auth/complete",
      headers: { origin: config.origin, cookie: dialogueCookie },
      payload: {},
    });
    if (completed.statusCode !== 200)
      throw Error("Synthetic authentication failed");
    const cookie = String(completed.headers["set-cookie"])
      .split(",")
      .find((c) => c.trim().startsWith("session="))!
      .trim()
      .split(";")[0];
    const id = randomUUID(),
      page = "p".repeat(64),
      start = Date.now() - 60000,
      deadline = Date.now() + 600000;
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,last_contact,page_hash) VALUES(?,'e','student',10001,'ACTIVE',?,?,?,?,?,?)",
      )
      .run(
        id,
        JSON.stringify(exam),
        start,
        deadline,
        deadline,
        Date.now(),
        hash(page),
      );
    const headers = {
      origin: config.origin,
      cookie,
      "x-page-instance": page,
      "x-csrf-token": completed.json().csrf,
    };
    const jpeg = (
      await sharp({
        create: { width: 2, height: 2, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer()
    ).toString("base64");
    let seq = 0;
    const capture = async () =>
      Promise.all(
        ["screen", "webcam"].map((source) =>
          app.inject({
            method: "POST",
            url: `/api/student/attempts/${id}/frames`,
            headers,
            payload: {
              source,
              seq: ++seq,
              captured: Date.now(),
              monotonic: performance.now(),
              data: jpeg,
            },
          }),
        ),
      );
    const initialCaptures = await capture();
    if (initialCaptures.some((r) => r.statusCode !== 200))
      throw Error(
        "Synthetic capture rejected: " +
          initialCaptures.map((r) => r.body).join("; "),
      );
    const ws = await open("/api/student/session", cookie);
    const messages: any[] = [];
    ws.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()));
      if (messages.length > 128) messages.shift();
    });
    const send = (message: any) =>
      ws.send(JSON.stringify({ v: 1, ...message }));
    const binding = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("Synthetic bind missing")),
        3000,
      );
      const receive = (raw: WebSocket.RawData) => {
        const m = JSON.parse(raw.toString());
        if (m.binding !== binding) return;
        clearTimeout(timeout);
        ws.off("message", receive);
        resolve();
      };
      ws.on("message", receive);
      send({ type: "bind", attempt: id, page, binding });
    });
    if (!connection?.alive) throw Error("Synthetic SSH connection missing");
    return {
      app,
      store,
      life,
      h,
      connection,
      id,
      page,
      deadline,
      headers,
      ws,
      messages,
      send,
      capture,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export const monitoringReady = {
  fullscreen: true,
  keyboard: true,
  screen: true,
  webcam: true,
  focus: true,
  visible: true,
};
