import { expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { createApp } from "../../apps/server/src/app.js";
import type { IsolatedConnection } from "../../apps/server/src/connection-process.js";

import { hosts } from "../fixtures/hosts.js";
async function setup(options: Parameters<typeof hosts>[0] = {}) {
  const h = await hosts(options);
  const dir = mkdtempSync(tmpdir() + "/login-security-");
  let logs = "";
  const config: any = {
    mode: "development",
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
  let connection: IsolatedConnection | undefined;
  const { app, store } = await createApp(config, {
    onConnection: (value) => {
      connection = value;
    },
    logStream: new Writable({
      write(chunk, _encoding, done) {
        logs += chunk.toString();
        done();
      },
    }),
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  config.origin = origin;
  const started = await app.inject({
    method: "POST",
    url: "/api/auth/start",
    headers: { origin },
    payload: {},
  });
  const cookie = String(started.headers["set-cookie"]).split(";")[0];
  const ws = new WebSocket(
    origin.replace("http:", "ws:") + "/api/auth/dialogue",
    { headers: { origin, cookie } },
  );
  const messages: any[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return {
    h,
    dir,
    app,
    store,
    origin,
    cookie,
    ws,
    messages,
    logs: () => logs,
    connection: () => connection,
    close: async () => {
      ws.terminate();
      await app.close();
      await h.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
async function until(fn: () => boolean) {
  await vi.waitFor(() => expect(fn()).toBe(true), {
    timeout: 5000,
    interval: 10,
  });
}
function start(ws: WebSocket) {
  ws.send(
    JSON.stringify({
      v: 1,
      type: "start",
      exam: "unused",
      username: "student",
    }),
  );
}
function answer(ws: WebSocket, challenge: any, password: string) {
  ws.send(
    JSON.stringify({
      v: 1,
      type: "answers",
      round: challenge.round,
      answers: [password],
    }),
  );
}
function checkStored(dir: string, password: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) checkStored(file, password);
    else expect(readFileSync(file).includes(Buffer.from(password))).toBe(false);
  }
}
it.each([false, true])(
  "keeps HTTP/WS logs, audit, persistence and public errors secret-free (rejected=%s)",
  async (rejected) => {
    const password = "synthetic-" + randomUUID();
    const t = await setup({ password, rejectClass: rejected, mfaDelayMs: 10 });
    try {
      start(t.ws);
      await until(() => t.messages.some((m) => m.prompts?.length));
      const challenge = t.messages.find((m) => m.prompts?.length);
      expect(challenge.prompts).toEqual([
        { prompt: "Shared SSH password", echo: false },
      ]);
      answer(t.ws, challenge, password);
      await until(() =>
        t.messages.some(
          (m) => m.type === (rejected ? "error" : "authenticated"),
        ),
      );
      expect(t.messages.filter((m) => m.prompts?.length)).toHaveLength(1);
      expect(t.h.authCalls).toEqual({ jump: 1, class: 1 });
      expect(JSON.stringify(t.messages)).not.toContain(password);
      expect(t.logs()).not.toContain(password);
      expect(t.logs()).toContain("request completed");
      const tables = t.store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[];
      for (const { name } of tables)
        expect(
          JSON.stringify(
            t.store.db
              .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
              .all(),
          ),
        ).not.toContain(password);
      checkStored(t.dir, password);
      if (rejected)
        expect(t.messages.find((m) => m.type === "error").error).toMatch(
          /^SSH sign-in failed\./,
        );
      else {
        const complete = await t.app.inject({
          method: "POST",
          url: "/api/auth/complete",
          headers: { origin: t.origin, cookie: t.cookie },
          payload: {},
        });
        expect(complete.statusCode).toBe(200);
        expect(t.store.db.prepare("SELECT * FROM attempts").all()).toHaveLength(
          0,
        );
      }
    } finally {
      await t.close();
    }
  },
);
it.each(["disconnect", "cancel", "shutdown"])(
  "clears in-memory credentials on browser %s during phone approval",
  async (reason) => {
    const t = await setup({ mfaDelayMs: 5000 });
    try {
      start(t.ws);
      await until(() => t.messages.some((m) => m.prompts?.length));
      answer(
        t.ws,
        t.messages.find((m) => m.prompts?.length),
        "shared-password",
      );
      await until(() => t.messages.some((m) => m.instruction?.includes("42")));
      const c = t.connection()!;
      const child = (c as any).child;
      expect(child.pid).not.toBe(process.pid);
      expect(c.alive).toBe(false);
      if (reason === "shutdown") await t.app.close();
      else if (reason === "disconnect") t.ws.terminate();
      else t.ws.send(JSON.stringify({ v: 1, type: "cancel" }));
      await until(() => child.exitCode !== null || child.signalCode !== null);
      expect((c as any).dialogue).toBeUndefined();
      expect((c as any).replies.size).toBe(0);
      expect(t.h.authCalls.class).toBe(0);
      expect(t.logs()).not.toContain("shared-password");
    } finally {
      await t.close();
    }
  },
);

it("emails a sign-in worker crash without claiming an unstarted exam needs instructor authorization", async () => {
  const t = await setup({ mfaDelayMs: 5000 });
  try {
    start(t.ws);
    await until(() => t.messages.some((m) => m.prompts?.length));
    (t.connection() as any).child.kill("SIGKILL");
    await until(
      () =>
        (t.store.db.prepare("SELECT count(*) n FROM outbox").get() as any).n ===
        1,
    );
    const alert = t.store.db
      .prepare("SELECT subject,body FROM outbox")
      .get() as any;
    expect(alert.subject).toBe("Exam connection failure: student");
    expect(alert.body).toContain("Exam: unused");
    expect(alert.body).toContain("exam clock has not started");
    expect(alert.body).not.toMatch(/Instructor authorization|shared-password/);
    expect(t.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 0 },
    );
    expect((await t.app.inject({ url: "/health/live" })).statusCode).toBe(200);
  } finally {
    await t.close();
  }
});
