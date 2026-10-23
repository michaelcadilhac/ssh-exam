import { it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { createApp } from "../../apps/server/src/app.js";
import { Agent } from "../../apps/server/src/agent.js";
import { hosts } from "../fixtures/hosts.js";
import { grantExam } from "../fixtures/grant-exam.js";

it("saves single/CSV enrollments without an agent account list and preserves verified identities", async () => {
  const dir = mkdtempSync(tmpdir() + "/enrollment-identity-");
  const { app, store } = await createApp({
    mode: "development",
    origin: "http://localhost:3000",
    port: 3000,
    data: dir,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  });
  const spy = vi
    .spyOn(Agent.prototype, "call")
    .mockRejectedValue(Error("Agent unavailable"));
  try {
    grantExam(store, "e");
    const s = store.session("admin", "instructor", null);
    const headers = {
      cookie: `session=${s.token}`,
      origin: "http://localhost:3000",
      "x-csrf-token": s.csrf,
    };
    const post = (path: string, payload: any) =>
      app.inject({
        method: "POST",
        url: `/api/admin/exams/e/roster/${path}`,
        headers,
        payload,
      });
    expect(
      (await post("add", { username: "futurestudent", uid: 1234 })).statusCode,
    ).toBe(200);
    expect(
      store.db
        .prepare("SELECT uid FROM enrollments WHERE username='futurestudent'")
        .get(),
    ).toEqual({ uid: 0 });
    expect((await post("add", { username: "futurestudent" })).statusCode).toBe(
      400,
    );
    expect((await post("add", { username: "root" })).statusCode).toBe(400);
    store.db
      .prepare("UPDATE enrollments SET uid=1200 WHERE username='futurestudent'")
      .run();
    const preview = await post("import-preview", {
      text: "username,require_webcam,duration_minutes\nfuturestudent,true,120\nanotherstudent,false,90",
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().summary).toEqual({
      added: 1,
      changed: 1,
      unchanged: 0,
    });
    for (let n = 0; n < 2; n++)
      expect(
        (await post("import-confirm", { id: preview.json().id })).statusCode,
      ).toBe(200);
    expect(
      store.db
        .prepare(
          "SELECT username,uid,webcam,duration FROM enrollments ORDER BY username",
        )
        .all(),
    ).toEqual([
      { username: "anotherstudent", uid: 0, webcam: 0, duration: 5400 },
      { username: "futurestudent", uid: 1200, webcam: 1, duration: 7200 },
    ]);
    expect(
      spy.mock.calls.filter(([op]) => op === "resolve-course-accounts"),
    ).toEqual([]);
    expect(store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual({
      n: 0,
    });
  } finally {
    spy.mockRestore();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each(["accepted", "denied", "invalid-uid", "not-enrolled"])(
  "verifies course identity only through live SSH at login: %s",
  async (outcome) => {
    const h = await hosts();
    const dir = mkdtempSync(tmpdir() + "/ssh-login-identity-");
    const config = {
      mode: "development" as const,
      origin: "http://127.0.0.1",
      data: dir,
      port: 0,
      jump: h.jump,
      class: h.class,
      agent: h.agentConfig,
      maintenance: false,
    };
    const { app, store } = await createApp(config);
    const commands: { op: string; body: any }[] = [];
    h.control.command = async (op, body) => {
      commands.push({ op, body });
      if (op === "register") return { uid: 10001 };
      if (op === "resolve-course-accounts") {
        expect(body).toEqual({ usernames: ["student"], exam: "e" });
        if (outcome === "denied")
          throw Error("Account not approved by class server");
        return { student: outcome === "invalid-uid" ? 0 : 10001 };
      }
      throw Error("Unexpected SSH command");
    };
    let ws: WebSocket | undefined;
    try {
      store.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
      if (outcome !== "not-enrolled")
        store.db
          .prepare(
            "INSERT INTO enrollments(exam,username,uid) VALUES('e','student',0)",
          )
          .run();
      store.db
        .prepare("INSERT INTO agent_snapshot VALUES('class',1,?)")
        .run(JSON.stringify({ accounts: { student: 9999 } }));
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      config.origin = origin;
      const started = await app.inject({
        method: "POST",
        url: "/api/auth/start",
        headers: { origin },
        payload: {},
      });
      const cookie = String(started.headers["set-cookie"]).split(";")[0];
      ws = new WebSocket(
        origin.replace("http:", "ws:") + "/api/auth/dialogue",
        { headers: { origin, cookie } },
      );
      const result = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("Login timed out")), 10000);
        const finish = (value: any) => {
          clearTimeout(timer);
          resolve(value);
        };
        ws!.on("error", reject);
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
          if (m.type === "authenticated" || m.type === "error") finish(m);
        });
      });
      expect(result.type).toBe(
        outcome === "accepted" ? "authenticated" : "error",
      );
      const completed = await app.inject({
        method: "POST",
        url: "/api/auth/complete",
        headers: { origin, cookie },
        payload: {},
      });
      expect(completed.statusCode).toBe(outcome === "accepted" ? 200 : 400);
      if (outcome === "not-enrolled") {
        expect(result.error).toContain("not enrolled");
        expect(commands).toEqual([]);
        expect(h.counts.jump).toBe(0);
      } else {
        expect(commands.map((c) => c.op)).toEqual([
          "register",
          "resolve-course-accounts",
        ]);
        expect(
          store.db
            .prepare("SELECT uid FROM enrollments WHERE username='student'")
            .get(),
        ).toEqual({ uid: outcome === "accepted" ? 10001 : 0 });
      }
      expect(store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
        { n: 0 },
      );
    } finally {
      ws?.close();
      await app.close();
      await h.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  15000,
);
