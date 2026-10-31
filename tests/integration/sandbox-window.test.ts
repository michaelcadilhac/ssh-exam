import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createApp } from "../../apps/server/src/app.js";
import { hash } from "../../apps/server/src/db.js";
import WebSocket from "ws";
import { hosts } from "../fixtures/hosts.js";
import { grantExam } from "../fixtures/grant-exam.js";
import { AttemptGrants } from "../../apps/server/src/attempt-grants.js";

it("web sandbox settings preserve an explicit window, reject indefinite policy and leave saved attempts unchanged", async () => {
  const data = mkdtempSync(tmpdir() + "/sandbox-window-");
  const origin = "http://localhost:3000";
  const { app, store } = await createApp({
    mode: "development",
    origin,
    data,
    port: 0,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
    agent: { id: "class", signingKey: "/unused", callbackPublicKey: "/unused" },
  });
  try {
    const admin = store.session("admin", "instructor", null);
    const headers = {
      origin,
      cookie: `session=${admin.token}`,
      "x-csrf-token": admin.csrf,
    };
    const list = () => app.inject({ url: "/api/admin/exams", headers });
    const initial = (await list()).json().find((e: any) => e.id === "sandbox");
    expect(initial.latest).toBeLessThan(Date.now());
    const earliest = Date.now() - 60000,
      latest = Date.now() + 60000;
    const settings = {
      ...initial,
      earliest,
      latest,
      duration: 7200,
      webcam: true,
    };
    const saved = await app.inject({
      method: "POST",
      url: "/api/admin/exams",
      headers,
      payload: { ...settings, requestID: randomUUID() },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      earliest,
      latest,
      duration: 300,
      webcam: false,
    });
    const savedSettings = saved.json<any>();
    const snapshot = JSON.stringify(savedSettings);
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid) VALUES('sandbox','student',10001)",
      )
      .run();
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,page_hash,last_contact,preflight_started_at) VALUES('preflight','sandbox','student',10001,'PREPARING',?,?,?,?)",
      )
      .run(snapshot, hash("page"), Date.now(), Date.now());
    const before = store.attempt("preflight");
    const invalid = await app.inject({
      method: "POST",
      url: "/api/admin/exams",
      headers,
      payload: { ...savedSettings, earliest: 0, latest: 8640000000000000 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toMatch(/finite.*window/i);
    const changed = await app.inject({
      method: "POST",
      url: "/api/admin/exams",
      headers,
      payload: {
        ...savedSettings,
        earliest: latest + 60000,
        latest: latest + 120000,
      },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(store.attempt("preflight")).toEqual(before);
    expect(
      (await list()).json().find((e: any) => e.id === "sandbox"),
    ).toMatchObject({ earliest: latest + 60000, latest: latest + 120000 });

    // Authenticated actual Begin endpoint must reject before SSH or activation,
    // even for a legacy saved preparation; current defaults cannot substitute.
    const student = store.session("student", "student", "sandbox");
    const studentHeaders = {
      origin,
      cookie: `session=${student.token}`,
      "x-csrf-token": student.csrf,
      "x-page-instance": "page",
    };
    for (const window of [
      { earliest: 0, latest: 8640000000000000 },
      { earliest: Date.now() + 60000, latest: Date.now() + 120000 },
      { earliest: Date.now() - 120000, latest: Date.now() - 60000 },
    ]) {
      store.db
        .prepare("UPDATE attempts SET settings=? WHERE id='preflight'")
        .run(JSON.stringify({ ...savedSettings, ...window }));
      const reply = await app.inject({
        method: "POST",
        url: "/api/student/attempts/preflight/begin",
        headers: studentHeaders,
        payload: {
          screen: true,
          keyboard: true,
          fullscreen: true,
          focus: true,
          visible: true,
          webcam: false,
        },
      });
      expect(reply.statusCode).toBe(400);
      if (window.earliest === 0)
        expect(reply.json().error).toMatch(/opening and closing times/i);
      else
        expect(reply.json().error).toBe(
          "This attempt cannot start right now. Ask your instructor when you can start. No new attempt was started.",
        );
      expect(store.attempt("preflight")).toMatchObject({
        state: "PREPARING",
        start: null,
        deadline: null,
        original_deadline: null,
      });
    }
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});

it.each([false, true])(
  "globally closed practice refuses every username before SSH allocation (%s browser SSH)",
  async (browserSSH) => {
    const h = await hosts(),
      data = mkdtempSync(tmpdir() + "/sandbox-early-window-");
    const config = {
      mode: "development" as const,
      origin: "http://127.0.0.1",
      data,
      port: 0,
      maintenance: false,
      jump: h.jump,
      class: h.class,
      agent: h.agentConfig,
      ...(browserSSH
        ? {
            browserSSH: {
              relay: "ws://127.0.0.1:1/unused",
              audience: "synthetic-early-window",
            },
          }
        : {}),
    };
    let allocations = 0;
    const { app, store } = await createApp(config, {
      onConnection: () => {
        allocations++;
      },
    });
    const sockets: WebSocket[] = [];
    try {
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      config.origin = origin;
      const definition = grantExam(store, "sandbox");
      store.db.prepare("UPDATE exams SET config=? WHERE id='sandbox'").run(
        JSON.stringify({
          ...definition,
          duration: 300,
          webcam: false,
          earliest: Date.now() - 120000,
          latest: Date.now() - 60000,
        }),
      );
      store.db
        .prepare(
          "INSERT INTO enrollments(exam,username,uid) VALUES('sandbox','student',10001)",
        )
        .run();
      const tables = [
        "attempts",
        "attempt_grants",
        "grant_claims",
        "grant_begin_intents",
        "enrollments",
        "incidents",
        "outbox",
      ];
      const domain = () =>
        Object.fromEntries(
          tables.map((table) => [
            table,
            store.db.prepare(`SELECT * FROM ${table}`).all(),
          ]),
        );
      const before = domain();
      for (const username of ["student", "never-enrolled"]) {
        const start = await app.inject({
          method: "POST",
          url: "/api/auth/start",
          headers: { origin },
          payload: {},
        });
        expect(start.statusCode).toBe(200);
        const cookie = String(start.headers["set-cookie"]).split(";")[0];
        const ws = new WebSocket(
          origin.replace("http:", "ws:") + "/api/auth/dialogue",
          { headers: { origin, cookie } },
        );
        sockets.push(ws);
        const first = await new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(Error("No bounded practice eligibility reply")),
            5000,
          );
          ws.once("error", (error) => {
            clearTimeout(timeout);
            reject(error);
          });
          ws.once("message", (raw) => {
            clearTimeout(timeout);
            resolve(JSON.parse(raw.toString()));
          });
          ws.once("open", () =>
            ws.send(
              JSON.stringify({
                v: 1,
                type: "start",
                username,
                exam: "sandbox",
              }),
            ),
          );
        });
        expect(first).toMatchObject({
          type: "error",
          error: "Practice is closed. Ask your instructor to open it.",
        });
        expect(first).not.toHaveProperty("prompts");
        expect(allocations).toBe(0);
        expect(h.authCalls).toEqual({ jump: 0, class: 0 });
        expect(domain()).toEqual(before);
        ws.close();
      }
    } finally {
      for (const ws of sockets) ws.terminate();
      await app.close();
      await h.close();
      rmSync(data, { recursive: true, force: true });
    }
  },
);

it.each([
  {
    label: "nullable historical access hold",
    state: "COMPLETED",
    start: 1,
    access: null,
    policy: "NORMAL",
    policyError: null,
    accessError: null,
  },
  {
    label: "cancelled policy restoration",
    state: "CANCELLED_BEFORE_START",
    start: null,
    access: "RELEASED",
    policy: "RESTORING",
    policyError: null,
    accessError: null,
  },
  {
    label: "cancelled policy error",
    state: "CANCELLED_BEFORE_START",
    start: null,
    access: "RELEASED",
    policy: "NORMAL",
    policyError: "synthetic restoration error",
    accessError: null,
  },
  {
    label: "cancelled access error",
    state: "CANCELLED_BEFORE_START",
    start: null,
    access: "RELEASED",
    policy: "NORMAL",
    policyError: null,
    accessError: "synthetic cleanup error",
  },
])(
  "global practice availability preserves inspection for $label",
  async (entry) => {
    const data = mkdtempSync(tmpdir() + "/sandbox-nullable-hold-");
    const { app, store } = await createApp({
      mode: "development",
      origin: "http://localhost:3000",
      data,
      port: 0,
      maintenance: false,
      jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
      class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
      agent: {
        id: "class",
        signingKey: "/unused",
        callbackPublicKey: "/unused",
      },
    });
    try {
      // Deliberately contradictory historical projection. CTAS removes modern
      // NOT NULL constraints without modifying the real schema or executing work.
      // Keep this helper-only check synchronous; remove the shadow before cleanup.
      store.db.exec(
        "CREATE TEMP TABLE attempts AS SELECT * FROM main.attempts",
      );
      store.db
        .prepare(
          "INSERT INTO temp.attempts(id,exam,username,uid,state,settings,start,deadline,protected,access_state,policy_state,policy_error,access_error) VALUES('uncertain-history','sandbox','other-student',10002,?,'{}',?,2,1,?,?,?,?)",
        )
        .run(
          entry.state,
          entry.start,
          entry.access,
          entry.policy,
          entry.policyError,
          entry.accessError,
        );
      const before = store.db.prepare("SELECT * FROM temp.attempts").all();
      expect(
        new AttemptGrants(store, "class").practiceSignInBlock(),
      ).toBeNull();
      expect(store.db.prepare("SELECT * FROM temp.attempts").all()).toEqual(
        before,
      );
      expect(
        store.db.prepare("SELECT count(*) n FROM main.attempts").get(),
      ).toEqual({ n: 0 });
    } finally {
      store.db.exec("DROP TABLE IF EXISTS temp.attempts");
      await app.close();
      rmSync(data, { recursive: true, force: true });
    }
  },
);
