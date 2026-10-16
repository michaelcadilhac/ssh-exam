import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadConfig } from "../../packages/config/index.js";
import { createApp } from "../../apps/server/src/app.js";
it("boots production maintenance without false signoffs, serves operators and refuses exam preparation", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-production-bootstrap-");
  const file = dir + "/config.json";
  const config = {
    mode: "production",
    origin: "https://ssh-exam.example.edu",
    data: dir + "/data",
    maintenance: true,
    jump: { host: "jump.example.edu", pins: ["a".repeat(64)] },
    class: { host: "class.example.edu", pins: ["b".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
  };
  try {
    writeFileSync(file, JSON.stringify(config));
    const { app, store } = await createApp(loadConfig(file));
    try {
      expect((await app.inject({ url: "/health/live" })).statusCode).toBe(200);
      const status = await app.inject({ url: "/health/ready" });
      expect(status.statusCode).toBe(503);
      expect(status.json()).toMatchObject({
        ready: false,
        maintenance: true,
        mode: "production",
        productionReady: false,
      });
      expect(
        (await app.inject({ url: "/api/login-test" })).json().maintenance,
      ).toBe(true);
      const student = store.session("student", "alice", "sandbox");
      const start = await app.inject({
        method: "POST",
        url: "/api/student/preflight",
        headers: {
          origin: config.origin,
          cookie: `session=${student.token}`,
          "x-csrf-token": student.csrf,
        },
        payload: {},
      });
      expect(start.json().error).toContain("paused for maintenance");
    } finally {
      await app.close();
    }
    writeFileSync(file, JSON.stringify({ ...config, maintenance: false }));
    expect(() => loadConfig(file)).toThrow(/Notifications|Readiness/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("privileged functional tests require development mode at both config and app boundaries", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-functional-");
  const base = {
    mode: "development",
    origin: "http://localhost:3001",
    functionalTest: true,
    jump: { host: "jump.example.edu", pins: ["a".repeat(64)] },
    class: { host: "class.example.edu", pins: ["b".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
  };
  try {
    const file = dir + "/config.json";
    writeFileSync(file, JSON.stringify(base));
    expect(loadConfig(file).functionalTest).toBe(true);
    writeFileSync(file, JSON.stringify({ ...base, mode: "production" }));
    expect(() => loadConfig(file)).toThrow(
      /Privileged functional testing requires development/,
    );
    await expect(
      createApp({ ...base, mode: "production" } as any),
    ).rejects.toThrow(/Privileged functional testing requires development/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("production accepts a qualified administrator sandbox and keeps ordinary roster access restricted", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-production-sandbox-");
  const readiness = dir + "/readiness.json";
  writeFileSync(
    readiness,
    JSON.stringify(
      Object.fromEntries(
        [
          "institutionalSSH",
          "browserMatrix",
          "serverGuards",
          "protectedCollection",
          "sshCommandTransport",
          "statusCallbacks",
          "intervalAccessHold",
          "alerts",
        ].map((k) => [k, true]),
      ),
    ),
  );
  const config: any = {
    mode: "production",
    origin: "https://exam.example.edu",
    data: dir + "/data",
    maintenance: false,
    readinessFile: readiness,
    smtp: {
      socket: dir + "/unused.sock",
      from: "exam@example.edu",
      to: ["instructor@example.edu"],
    },
    jump: { host: "jump.example.edu", pins: ["a".repeat(64)] },
    class: { host: "class.example.edu", pins: ["b".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
  };
  const { app, store } = await createApp(config);
  const { Agent } = await import("../../apps/server/src/agent.js");
  const agent = new Agent(config.agent, store);
  try {
    const health = {
      ready: true,
      production_ready: true,
      functional_test: false,
      administrator_sandbox_accounts: ["admin"],
      capabilities: [
        "interval-access-hold",
        "all-session-channel-gate",
        "signed-ssh-control",
        "durable-status-callbacks",
        "server-only-submissions",
        "clock-reset",
        "deadline-timing-check",
      ],
    };
    store.db
      .prepare("INSERT INTO agent_snapshot VALUES(?,?,?)")
      .run(
        "class",
        1,
        JSON.stringify({ health, accounts: { admin: 1001, student: 1002 } }),
      );
    expect((await app.inject({ url: "/health/ready" })).statusCode).toBe(200);
    expect(
      await agent.call("resolve-course-accounts", {
        usernames: ["admin"],
        exam: "sandbox",
      }),
    ).toEqual({ admin: 1001 });
    await expect(
      agent.call("resolve-course-accounts", {
        usernames: ["admin"],
        exam: "midterm",
      }),
    ).rejects.toThrow(/only for sandbox/);
    expect(
      await agent.call("resolve-course-accounts", {
        usernames: ["student"],
        exam: "midterm",
      }),
    ).toEqual({ student: 1002 });
    store.db.prepare("UPDATE agent_snapshot SET payload=?").run(
      JSON.stringify({
        health: { ...health, functional_test: true },
        accounts: { admin: 1001 },
      }),
    );
    expect((await app.inject({ url: "/health/ready" })).statusCode).toBe(503);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
