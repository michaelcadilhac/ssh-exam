import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { createApp } from "../../apps/server/src/app.js";
import { SIGN_IN_NOTICE_GRACE_MS } from "../../apps/server/src/sign-in-notifications.js";
import { hosts } from "../fixtures/hosts.js";
import { smtpFixture } from "../fixtures/smtp.js";

async function until(check: () => boolean) {
  const deadline = performance.now() + 9000;
  while (!check() && performance.now() < deadline) await delay(20);
  expect(check()).toBe(true);
}

async function fixture() {
  const data = mkdtempSync(tmpdir() + "/signin-delivery-");
  const h = await hosts({
    password: "synthetic-notice-secret",
    mfaDelayMs: 10,
  });
  const smtp = await smtpFixture(data + "/smtp.sock");
  const config: any = {
    mode: "development",
    loginOnly: true,
    origin: "http://127.0.0.1",
    data,
    port: 0,
    maintenance: false,
    jump: h.jump,
    class: h.class,
    agent: h.agentConfig,
    smtp: {
      socket: data + "/smtp.sock",
      from: "exam@example.edu",
      to: ["instructor@example.edu"],
    },
  };
  let shortConnect = true;
  const options = {
    logStream: new Writable({
      write(_c, _e, cb) {
        cb();
      },
    }),
    onConnection: (connection: any) => {
      const rpc = connection.rpc.bind(connection);
      connection.rpc = (op: string, args: any[]) => {
        if (!shortConnect || op !== "connect") return rpc(op, args);
        // Accelerate ONLY this real supervisor connect timer in this fixture.
        // Real SSH, worker cleanup, failure callback, HTTP/WS and SMTP still run.
        const native = globalThis.setTimeout;
        const spy = vi
          .spyOn(globalThis, "setTimeout")
          .mockImplementation(((fn: any, ms: any, ...rest: any[]) =>
            native(
              fn,
              ms === 60000 ? 1500 : ms,
              ...rest,
            )) as typeof setTimeout);
        try {
          return rpc(op, args);
        } finally {
          spy.mockRestore();
        }
      };
    },
  };
  let running = await createApp(config, options);
  config.origin = await running.app.listen({ host: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [];
  const login = async (success = false) => {
    shortConnect = !success;
    const start = await running.app.inject({
      method: "POST",
      url: "/api/auth/start",
      headers: { origin: config.origin },
      payload: {},
    });
    expect(start.statusCode).toBe(200);
    const cookie = String(start.headers["set-cookie"]).split(";")[0];
    const ws = new WebSocket(
      config.origin.replace("http:", "ws:") + "/api/auth/dialogue",
      { headers: { origin: config.origin, cookie } },
    );
    sockets.push(ws);
    const received: any[] = [];
    ws.on("message", (bytes) => {
      const m = JSON.parse(bytes.toString());
      received.push(m);
      if (success && m.prompts?.length)
        ws.send(
          JSON.stringify({
            v: 1,
            type: "answers",
            round: m.round,
            answers: ["synthetic-notice-secret"],
          }),
        );
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    ws.send(
      JSON.stringify({
        v: 1,
        type: "start",
        exam: "synthetic-notices",
        username: "notices01",
      }),
    );
    await until(() =>
      received.some((m) => m.type === (success ? "authenticated" : "error")),
    );
    if (success) {
      const completed = await running.app.inject({
        method: "POST",
        url: "/api/auth/complete",
        headers: { origin: config.origin, cookie },
        payload: {},
      });
      expect(completed.statusCode).toBe(200);
    }
  };
  return {
    get app() {
      return running.app;
    },
    get store() {
      return running.store;
    },
    get origin() {
      return config.origin;
    },
    smtp,
    login,
    restart: async (loginOnly = true) => {
      await running.app.close();
      config.loginOnly = loginOnly;
      running = await createApp(config, options);
      config.origin = await running.app.listen({ host: "127.0.0.1", port: 0 });
    },
    close: async () => {
      for (const s of sockets) s.terminate();
      await running.app.close();
      await h.close();
      await smtp.close();
      rmSync(data, { recursive: true, force: true });
    },
  };
}

it("real sign-in timeouts group across restart, deliver once through SMTP and resolve after successful retry", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const f = await fixture();
  try {
    const at = Date.now();
    await f.login();
    const first = f.store.db.prepare("SELECT * FROM outbox").get() as any;
    expect(first).toMatchObject({
      subject: "Sign-in help needed: notices01",
      status: "pending",
      next: at + SIGN_IN_NOTICE_GRACE_MS,
    });
    vi.setSystemTime(at + 1000);
    await f.login();
    expect(f.store.db.prepare("SELECT count(*) n FROM outbox").get()).toEqual({
      n: 1,
    });
    expect(f.smtp.messages).toHaveLength(0);
    await f.restart();
    vi.setSystemTime(at + SIGN_IN_NOTICE_GRACE_MS + 1);
    await until(
      () =>
        (
          f.store.db
            .prepare("SELECT status FROM outbox WHERE id=?")
            .get(first.id) as any
        ).status === "sent",
    );
    expect(f.smtp.messages).toHaveLength(1);
    expect(f.smtp.messages[0]).toContain(
      `Message-ID: <${first.id}@ssh-exam.local>`,
    );
    expect(f.smtp.messages[0]).not.toContain("synthetic-notice-secret");
    vi.setSystemTime(Date.now() + 1000);
    await f.login(true);
    const admin = f.store.session("admin", "instructor", null);
    // Admin exam operations intentionally refuse login-only fixtures. Reopen
    // the persisted data in normal development mode for the public admin read.
    await f.restart(false);
    const resolved = await f.app.inject({
      url: `/api/admin/notifications/${first.id}`,
      headers: { cookie: `session=${admin.token}` },
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect(resolved.json()).toMatchObject({
      status: "sent",
      remindable: false,
      episode: { event: "sign-in-timeout" },
    });
    expect(f.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 0 },
    );
    expect(f.smtp.messages).toHaveLength(1);
  } finally {
    vi.useRealTimers();
    await f.close();
  }
}, 45000);

it("a lone timeout is suppressed at delivery and successful sign-in cancels pending repeated failures", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const f = await fixture();
  try {
    await f.login();
    const first = f.store.db.prepare("SELECT id FROM outbox").get() as any;
    vi.setSystemTime(Date.now() + SIGN_IN_NOTICE_GRACE_MS + 1);
    await until(
      () =>
        (
          f.store.db
            .prepare("SELECT status FROM outbox WHERE id=?")
            .get(first.id) as any
        ).status === "cancelled",
    );
    await f.login();
    vi.setSystemTime(Date.now() + 1000);
    await f.login();
    expect(
      f.store.db
        .prepare("SELECT count(*) n FROM outbox WHERE status='pending'")
        .get(),
    ).toEqual({ n: 1 });
    vi.setSystemTime(Date.now() + 1000);
    await f.login(true);
    expect(
      f.store.db
        .prepare("SELECT count(*) n FROM outbox WHERE status='pending'")
        .get(),
    ).toEqual({ n: 0 });
    vi.setSystemTime(Date.now() + SIGN_IN_NOTICE_GRACE_MS + 1);
    await delay(5500);
    expect(f.smtp.messages).toHaveLength(0);
    expect(f.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 0 },
    );
  } finally {
    vi.useRealTimers();
    await f.close();
  }
}, 45000);
