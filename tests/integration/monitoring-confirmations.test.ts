import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { createApp } from "../../apps/server/src/app.js";
import { hash } from "../../apps/server/src/db.js";

it("echoes each monitoring confirmation on the authenticated page-owned socket", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-monitoring-");
  const config = {
    mode: "development" as const,
    origin: "http://127.0.0.1",
    data: dir,
    port: 0,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  };
  const { app, store } = await createApp(config);
  let socket: WebSocket | undefined;
  try {
    config.origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const id = randomUUID(),
      page = "p".repeat(64);
    store.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,page_hash,last_contact) VALUES(?,'e','alice',1001,'PREPARING','{}',?,?)",
      )
      .run(id, hash(page), Date.now());
    const session = store.session("student", "alice", "e");
    socket = new WebSocket(
      config.origin.replace("http:", "ws:") + "/api/student/session",
      {
        headers: { origin: config.origin, cookie: `session=${session.token}` },
      },
    );
    await new Promise<void>((resolve, reject) => {
      socket!.once("open", resolve);
      socket!.once("error", reject);
    });
    const request = (message: any) =>
      new Promise<any>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Monitoring reply missing")),
          3000,
        );
        socket!.once("message", (raw) => {
          clearTimeout(timer);
          resolve(JSON.parse(raw.toString()));
        });
        socket!.send(JSON.stringify({ v: 1, ...message }));
      });
    const binding = randomUUID();
    expect(
      (await request({ type: "bind", attempt: id, page, binding })).binding,
    ).toBe(binding);
    for (const type of ["preflight-contact", "heartbeat"]) {
      const confirmation = randomUUID();
      const reply = await request({
        type,
        confirmation,
        ready: {
          fullscreen: true,
          keyboard: true,
          screen: true,
          webcam: false,
          focus: true,
          visible: true,
        },
      });
      expect(reply.type).toBe("state");
      expect(reply.confirmation).toBe(confirmation);
      expect(reply.attempt.id).toBe(id);
    }
    const invalid = await request({
      type: "preflight-contact",
      confirmation: "invalid",
    });
    expect(invalid.type).toBe("error");
    expect(invalid.confirmation).toBeUndefined();
  } finally {
    socket?.terminate();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
