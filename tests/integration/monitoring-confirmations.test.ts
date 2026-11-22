import { expect, it, vi } from "vitest";
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
  const { app, store, life } = await createApp(config);
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

    let clock = Date.now();
    const currentTime = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const native = vi.spyOn(life.agent, "call").mockResolvedValue({});
    try {
      const deadline = clock + 120000;
      store.db
        .prepare(
          "UPDATE attempts SET state='ACTIVE',settings=?,start=?,deadline=?,original_deadline=?,monitoring_mode='v1' WHERE id=?",
        )
        .run(JSON.stringify({ webcam: true }), clock, deadline, deadline, id);
      const ready = {
        fullscreen: true,
        keyboard: true,
        screen: true,
        webcam: true,
        focus: true,
        visible: true,
      };
      const conditions = (patch: object, generation = 0) =>
        request({
          type: "conditions",
          generation,
          connected: true,
          ready: { ...ready, ...patch },
        });
      await request({
        type: "conditions",
        generation: 0,
        connected: false,
        ready,
      });
      clock += 16000;
      await conditions({});
      expect(store.attempt(id).focus_lost_at).toBeNull();
      expect(store.attempt(id).state).toBe("ACTIVE");
      expect(native).not.toHaveBeenCalled();
      await conditions({ visible: false });
      const first = store.attempt(id).focus_lost_at;
      expect(first).toBe(clock);
      expect(store.attempt(id).state).toBe("ACTIVE");
      expect(
        store.db
          .prepare("SELECT count(*) AS n FROM incidents WHERE attempt=?")
          .get(id),
      ).toEqual({ n: 0 });
      clock += 10000;
      await conditions({ fullscreen: false });
      expect(store.attempt(id).focus_lost_at).toBe(first);
      clock += 4999;
      await conditions({});
      expect(store.attempt(id).focus_lost_at).toBeNull();
      expect(store.attempt(id).deadline).toBe(deadline);
      await conditions({ visible: false }, 99);
      expect(store.attempt(id).focus_lost_at).toBeNull();
      await request({
        type: "heartbeat",
        generation: 99,
        ready: { ...ready, visible: false },
      });
      expect(store.attempt(id).focus_lost_at).toBeNull();
      await conditions({ webcam: false });
      clock += 15000;
      await conditions({});
      expect(store.attempt(id)).toMatchObject({
        state: "LOCKED",
        generation: 1,
        deadline,
      });
      expect(native).toHaveBeenCalledTimes(1);
    } finally {
      native.mockRestore();
      currentTime.mockRestore();
    }
  } finally {
    socket?.terminate();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
