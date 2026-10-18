import { parseRoster } from "../../apps/server/src/roster.js";
import { it, expect } from "vitest";
import { createApp } from "../../apps/server/src/app.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
it("enforces role, ownership, CSRF, media protection and origin without revealing other enrollments", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-http-");
  const { app, store } = await createApp({
    mode: "development",
    origin: "http://localhost:3000",
    data: dir,
    port: 3000,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  });
  try {
    store.db.prepare("INSERT INTO exams VALUES(?,?)").run("exam", "{}");
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('other','exam','bob',1002,'COMPLETED','{}')",
      )
      .run();
    const s = store.session("student", "alice", "exam");
    const cookie = `session=${s.token}`;
    expect((await app.inject({ url: "/api/admin/attempts" })).statusCode).toBe(
      401,
    );
    expect(
      (await app.inject({ url: "/api/admin/attempts", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: "/api/student/attempts/other/status",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: "/api/admin/media/guessed",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/student/attempts/other/finish",
          headers: { cookie, origin: "http://localhost:3000" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/start",
          headers: { origin: "https://evil.invalid" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ url: "/health/live" })).statusCode).toBe(200);
    const session = await app.inject({
      url: "/api/session",
      headers: { cookie },
    });
    expect(session.json().csrf).toBe(s.csrf);
    expect(session.headers["cache-control"]).toBe("no-store");
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("confirms imports idempotently, preserves omitted fields and rejects stale previews", async () => {
  const { vi } = await import("vitest");
  const { Agent } = await import("../../apps/server/src/agent.js");
  const mock = vi
    .spyOn(Agent.prototype, "call")
    .mockImplementation(async (op: string) => {
      if (op === "resolve-course-accounts") return { alice: 1001, bob: 1002 };
      throw Error("Fixture only");
    });
  const dir = mkdtempSync(tmpdir() + "/exam-import-");
  const { app, store } = await createApp({
    mode: "development",
    origin: "http://localhost:3000",
    data: dir,
    port: 3000,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  });
  try {
    store.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
    store.db
      .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
      .run("e", "alice", 1, 8100, "Alice", 1001);
    const s = store.session("admin", "instructor", null),
      headers = {
        cookie: `session=${s.token}`,
        origin: "http://localhost:3000",
        "x-csrf-token": s.csrf,
      };
    const preview = await app.inject({
      method: "POST",
      url: "/api/admin/exams/e/roster/import-preview",
      headers,
      payload: { text: "username,require_webcam\nalice,false\nbob,inherit" },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).not.toContain("display_name");
    expect(preview.body).not.toContain('"Alice"');
    for (const path of ["roster", "dashboard", "roster/export"]) {
      const response = await app.inject({
        url: `/api/admin/exams/e/${path}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain("display_name");
      expect(response.body).not.toContain('"Alice"');
    }
    const exampleURL = "/api/admin/exams/e/roster/example";
    expect((await app.inject({ url: exampleURL })).statusCode).toBe(401);
    const student = store.session("student", "alice", "e");
    expect(
      (
        await app.inject({
          url: exampleURL,
          headers: { cookie: `session=${student.token}` },
        })
      ).statusCode,
    ).toBe(401);
    const example = await app.inject({ url: exampleURL, headers });
    expect(example.statusCode).toBe(200);
    expect(example.headers["content-type"]).toContain("text/csv");
    expect(example.headers["content-disposition"]).toContain(
      'filename="example-roster.csv"',
    );
    expect(parseRoster(example.body)).toEqual([
      { username: "student01", webcam: null, duration: null },
      { username: "student02", webcam: true, duration: null },
      { username: "student03", webcam: false, duration: null },
    ]);
    expect(
      (
        await app.inject({
          url: "/api/admin/exams/missing/roster/example",
          headers,
        })
      ).statusCode,
    ).toBe(400);
    const removedColumn = await app.inject({
      method: "POST",
      url: "/api/admin/exams/e/roster/import-preview",
      headers,
      payload: { text: "username,display_name\nalice,Changed" },
    });
    expect(removedColumn.statusCode).toBe(400);
    expect(removedColumn.json().error).toContain("unsupported headers");
    const confirm = () =>
      app.inject({
        method: "POST",
        url: "/api/admin/exams/e/roster/import-confirm",
        headers,
        payload: { id: preview.json().id },
      });
    expect((await confirm()).statusCode).toBe(200);
    expect((await confirm()).statusCode).toBe(200);
    const row = store.db
      .prepare("SELECT * FROM enrollments WHERE username='alice'")
      .get() as any;
    expect(row.webcam).toBe(0);
    expect(row.duration).toBe(8100);
    expect(row.display_name).toBe("Alice");
    expect(
      store.db.prepare("SELECT COUNT(*) n FROM enrollments").get(),
    ).toEqual({ n: 2 });
    const stale = await app.inject({
      method: "POST",
      url: "/api/admin/exams/e/roster/import-preview",
      headers,
      payload: { text: "username,require_webcam\nalice,true" },
    });
    store.db
      .prepare("UPDATE enrollments SET duration=7200 WHERE username='alice'")
      .run();
    const result = await app.inject({
      method: "POST",
      url: "/api/admin/exams/e/roster/import-confirm",
      headers,
      payload: { id: stale.json().id },
    });
    expect(result.statusCode).toBe(400);
    expect(result.json().error).toContain("changed since preview");
  } finally {
    await app.close();
    mock.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("adds and removes approved enrollments without changing attempts or allowing a removed student to begin", async () => {
  const { vi } = await import("vitest");
  const { Agent } = await import("../../apps/server/src/agent.js");
  const { hash } = await import("../../apps/server/src/db.js");
  const mock = vi
    .spyOn(Agent.prototype, "call")
    .mockImplementation(async (op: string) => {
      if (op === "resolve-course-accounts") return { alice: 1001, bob: 1002 };
      throw Error("No activation expected");
    });
  const dir = mkdtempSync(tmpdir() + "/exam-enrollment-");
  const { app, store } = await createApp({
    mode: "development",
    origin: "http://localhost:3000",
    data: dir,
    port: 3000,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  });
  try {
    store.db.prepare("INSERT INTO exams VALUES('e','{}'),('other','{}')").run();
    const admin = store.session("admin", "instructor", null),
      student = store.session("student", "alice", "e");
    const headers = {
      cookie: `session=${admin.token}`,
      origin: "http://localhost:3000",
      "x-csrf-token": admin.csrf,
    };
    const add = (exam: string, username: string) =>
      app.inject({
        method: "POST",
        url: `/api/admin/exams/${exam}/roster/add`,
        headers,
        payload: { username, webcam: false },
      });
    expect((await add("e", "alice")).statusCode).toBe(200);
    expect((await add("other", "alice")).statusCode).toBe(200);
    expect((await add("e", "alice")).statusCode).toBe(400);
    expect((await add("e", "unknown")).statusCode).toBe(200);
    const deadline = Date.now() + 5400000,
      page = "1".repeat(64);
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,page_hash) VALUES('active','other','alice',1001,'ACTIVE','{}',?,?,?)",
      )
      .run(Date.now(), deadline, hash(page));
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,page_hash) VALUES('pending','e','bob',1002,'PREPARING','{}',?)",
      )
      .run(hash(page));
    await add("e", "bob");
    const remove = (exam: string, username: string, extra: any = {}) =>
      app.inject({
        method: "POST",
        url: `/api/admin/exams/${exam}/roster/remove`,
        headers,
        payload: { username, confirm: true, ...extra },
      });
    expect(
      (await remove("other", "alice", { confirm: false })).statusCode,
    ).toBe(400);
    expect((await remove("other", "alice")).statusCode).toBe(200);
    expect(store.attempt("active").state).toBe("ACTIVE");
    expect(store.attempt("active").deadline).toBe(deadline);
    expect(
      store.db
        .prepare(
          "SELECT 1 FROM enrollments WHERE exam='e' AND username='alice'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/exams/e/roster/remove",
          headers: {
            ...headers,
            cookie: `session=${student.token}`,
            "x-csrf-token": student.csrf,
          },
          payload: { username: "alice", confirm: true },
        })
      ).statusCode,
    ).toBe(401);
    expect((await remove("e", "bob")).statusCode).toBe(200);
    const bob = store.session("student", "bob", "e");
    const begin = await app.inject({
      method: "POST",
      url: "/api/student/attempts/pending/begin",
      headers: {
        cookie: `session=${bob.token}`,
        origin: "http://localhost:3000",
        "x-csrf-token": bob.csrf,
        "x-page-instance": page,
      },
      payload: {
        fullscreen: true,
        focus: true,
        visible: true,
        keyboard: true,
        screen: true,
        webcam: false,
      },
    });
    expect(begin.statusCode).toBe(400);
    expect(begin.json().error).toContain("Enrollment removed");
    expect(store.attempt("pending").state).toBe("PREPARING");
  } finally {
    await app.close();
    mock.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("student sign-out revokes the session and locks execution without changing the deadline", async () => {
  const { vi } = await import("vitest");
  const { Agent } = await import("../../apps/server/src/agent.js");
  const mock = vi
    .spyOn(Agent.prototype, "call")
    .mockImplementation(async (op: string, b: any) => {
      expect(op).toBe("lock-attempt");
      return { state: "LOCKED", generation: b.generation };
    });
  const dir = mkdtempSync(tmpdir() + "/exam-logout-");
  const { app, store } = await createApp({
    mode: "development",
    origin: "http://localhost:3000",
    data: dir,
    port: 3000,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  });
  try {
    store.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
    const deadline = Date.now() + 5400000;
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline) VALUES('active','e','alice',1001,'LOCKED','{}',?,?)",
      )
      .run(Date.now(), deadline);
    // Startup reconciliation must not be mistaken for this sign-out action.
    store.db
      .prepare("UPDATE attempts SET state='ACTIVE' WHERE id='active'")
      .run();
    const s = store.session("student", "alice", "e"),
      headers = {
        cookie: `session=${s.token}`,
        origin: "http://localhost:3000",
        "x-csrf-token": s.csrf,
      };
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
    expect(store.attempt("active").state).toBe("LOCKED");
    expect(store.attempt("active").deadline).toBe(deadline);
    expect(
      (await app.inject({ url: "/api/session", headers })).statusCode,
    ).toBe(401);
    expect(
      store.db.prepare("SELECT 1 FROM audit WHERE action='logout'").get(),
    ).toBeTruthy();
  } finally {
    await app.close();
    mock.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("continuation failures explain recovery conditions, instructor approval and ended attempts", async () => {
  const { hash } = await import("../../apps/server/src/db.js");
  const dir = mkdtempSync(tmpdir() + "/exam-recovery-errors-");
  const { app, store } = await createApp({
    mode: "development",
    origin: "http://localhost:3000",
    data: dir,
    port: 3000,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  });
  try {
    store.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
    const deadline = Date.now() + 5400000,
      page = "2".repeat(64);
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,deadline,page_hash) VALUES('locked','e','alice',1001,'LOCKED','{}',?,?)",
      )
      .run(deadline, hash(page));
    const session = store.session("student", "alice", "e");
    const headers = {
      cookie: `session=${session.token}`,
      origin: "http://localhost:3000",
      "x-csrf-token": session.csrf,
      "x-page-instance": page,
    };
    const ready = {
      fullscreen: true,
      keyboard: true,
      screen: true,
      focus: true,
      visible: true,
      webcam: false,
    };
    const request = (payload: any) =>
      app.inject({
        method: "POST",
        url: "/api/student/attempts/locked/continue",
        headers,
        payload,
      });
    const missing = await request({
      ...ready,
      fullscreen: false,
      keyboard: false,
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe(
      "Restore fullscreen and keyboard lock before continuing.",
    );
    const unapproved = await request(ready);
    expect(unapproved.json().error).toContain(
      "Instructor authorization is required",
    );
    expect(store.attempt("locked").state).toBe("LOCKED");
    expect(store.attempt("locked").deadline).toBe(deadline);
    store.db
      .prepare("UPDATE attempts SET state='COMPLETED' WHERE id='locked'")
      .run();
    expect((await request({ ...ready, fullscreen: false })).json().error).toBe(
      "Your exam has ended. It can no longer be continued.",
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("expires an abandoned preparation even when no SSH connection survived a gateway restart", async () => {
  const { vi } = await import("vitest");
  const { Agent } = await import("../../apps/server/src/agent.js");
  const remote = { state: "PREPARING", start: 0 };
  const mock = vi
    .spyOn(Agent.prototype, "call")
    .mockImplementation(async (op) => {
      if (op === "cancel-attempt") remote.state = "CANCELLED_BEFORE_START";
      return remote;
    });
  const dir = mkdtempSync(tmpdir() + "/exam-orphan-preflight-");
  const { app, store } = await createApp({
    mode: "development",
    origin: "http://localhost:3000",
    data: dir,
    port: 3000,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
    preflightIdleMs: 1000,
  });
  try {
    store.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,last_contact) VALUES('orphan','e','alice',1001,'PREPARING','{}',?)",
      )
      .run(Date.now() - 600000);
    const session = store.session("student", "alice", "e");
    const status = await app.inject({
      url: "/api/student/attempts/orphan/status",
      headers: { cookie: `session=${session.token}` },
    });
    expect(status.json()).toMatchObject({
      authenticationGap: true,
      attempt: { state: "PREPARING", start: null, deadline: null },
    });
    await vi.waitFor(
      () =>
        expect(store.attempt("orphan").state).toBe("CANCELLED_BEFORE_START"),
      { timeout: 15000, interval: 100 },
    );
    expect(store.attempt("orphan").start).toBeNull();
    expect(store.attempt("orphan").deadline).toBeNull();
    expect(
      store.db.prepare("SELECT * FROM tombstones WHERE attempt='orphan'").get(),
    ).toBeTruthy();
    expect(
      store.db
        .prepare(
          "SELECT * FROM outbox WHERE subject='Collection requires recovery'",
        )
        .all(),
    ).toHaveLength(0);
  } finally {
    await app.close();
    mock.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);

it("login-only mode rejects production and blocks exam operations while exposing actual SSH test destinations", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-login-test-");
  const config = {
    mode: "development" as const,
    loginOnly: true,
    origin: "http://localhost:3000",
    data: dir,
    port: 3000,
    jump: { host: "sshjump.depaul.edu", port: 22, pins: ["0".repeat(64)] },
    class: { host: "csc-sys.cdm.depaul.edu", port: 22, pins: ["1".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  };
  await expect(createApp({ ...config, mode: "production" })).rejects.toThrow(
    "requires development mode",
  );
  const { app, store } = await createApp(config);
  try {
    const session = store.session("student", "realuser", "sample");
    const headers = {
      cookie: `session=${session.token}`,
      origin: config.origin,
      "x-csrf-token": session.csrf,
    };
    expect(
      (await app.inject({ url: "/api/student/exam", headers })).json(),
    ).toEqual({
      loginOnly: true,
      jump: config.jump.host,
      class: config.class.host,
    });
    expect((await app.inject({ url: "/health/ready" })).json()).toMatchObject({
      loginOnly: true,
      examReady: false,
    });
    for (const url of [
      "/api/student/preflight",
      "/api/student/attempts/a/begin",
      "/api/admin/attempts/a/end",
    ])
      expect(
        (await app.inject({ method: "POST", url, headers, payload: {} })).json()
          .error,
      ).toContain("unavailable during login-only testing");
    expect(store.db.prepare("SELECT * FROM attempts").all()).toHaveLength(0);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("completes login-only WebSocket challenges without enrollment or exam-agent admission", async () => {
  const { hosts } = await import("../fixtures/hosts.js");
  const { default: WebSocket } = await import("ws");
  const h = await hosts();
  const dir = mkdtempSync(tmpdir() + "/exam-login-dialogue-");
  const config = {
    mode: "development" as const,
    loginOnly: true,
    origin: "http://127.0.0.1",
    data: dir,
    port: 0,
    jump: h.jump,
    class: h.class,
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  };
  const { app, store } = await createApp(config);
  let ws: InstanceType<typeof WebSocket> | undefined;
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    config.origin = origin;
    const started = await app.inject({
      method: "POST",
      url: "/api/auth/start",
      headers: { origin },
      payload: {},
    });
    const dialogueCookie = String(started.headers["set-cookie"]).split(";")[0];
    ws = new WebSocket(origin.replace("http:", "ws:") + "/api/auth/dialogue", {
      headers: { origin, cookie: dialogueCookie },
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("Test authentication timed out")),
        10000,
      );
      ws!.on("error", reject);
      ws!.on("open", () =>
        ws!.send(
          JSON.stringify({
            v: 1,
            type: "start",
            exam: "sample",
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
        if (m.type === "authenticated") {
          clearTimeout(timeout);
          resolve();
        }
        if (m.type === "error") {
          clearTimeout(timeout);
          reject(Error(m.error));
        }
      });
    });
    const completed = await app.inject({
      method: "POST",
      url: "/api/auth/complete",
      headers: { origin, cookie: dialogueCookie },
      payload: {},
    });
    expect(completed.statusCode).toBe(200);
    const cookie = String(completed.headers["set-cookie"])
      .split(",")
      .find((c) => c.trim().startsWith("session="))!
      .trim()
      .split(";")[0];
    expect(
      (
        await app.inject({ url: "/api/student/exam", headers: { cookie } })
      ).json(),
    ).toMatchObject({ loginOnly: true });
    expect(h.counts).toEqual({ jump: 1, class: 1, panes: 0 });
    expect(store.db.prepare("SELECT * FROM attempts").all()).toHaveLength(0);
    expect(store.db.prepare("SELECT * FROM enrollments").all()).toHaveLength(0);
  } finally {
    ws?.close();
    await app.close();
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);
