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
      url: "https://agent.example.edu",
      ca: "unused",
      cert: "unused",
      key: "unused",
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
      url: "https://agent.example.edu",
      ca: "unused",
      cert: "unused",
      key: "unused",
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
