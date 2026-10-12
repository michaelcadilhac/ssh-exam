import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadConfig } from "../../packages/config/index.js";
import { createApp } from "../../apps/server/src/app.js";
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
