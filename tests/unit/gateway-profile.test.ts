import { expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { gatewayProfile } from "../fixtures/gateway-profile.js";

const fault = vi.hoisted(() => ({ write: false }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    writeSync: (...args: any[]) => {
      if (fault.write) throw Error("synthetic sink unavailable");
      return (fs.writeSync as any)(...args);
    },
  };
});
const connection = () => ({
  username: "examq",
  command: vi.fn(async (_op: string, _body?: unknown) => "normal reply"),
  prepareMonitoring: vi.fn(async () => true),
  secureAccess: vi.fn(async (_id: string, _exam: string) => {}),
});

it("records private metadata without payloads, and appends across a restart", async () => {
  const dir = mkdtempSync(tmpdir() + "/gateway-profile-");
  let p = gatewayProfile(dir);
  try {
    expect(p.snapshot()).toMatchObject({
      version: 1,
      stageSupport: true,
      failed: false,
    });
    const c = connection();
    p.onConnection(c);
    expect(await c.command("health", { password: "never-record-this" })).toBe(
      "normal reply",
    );
    const first = readFileSync(p.snapshot().path, "utf8");
    expect(first).not.toMatch(/password|never-record-this|normal reply/);
    expect(statSync(p.snapshot().path).mode & 0o777).toBe(0o600);
    p.close();
    p = gatewayProfile(dir);
    const next = connection();
    p.onConnection(next);
    await next.command("health");
    const all = readFileSync(p.snapshot().path, "utf8");
    expect(all.startsWith(first)).toBe(true);
    expect(
      all
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).event),
    ).toEqual(["started", "completed", "started", "completed"]);
  } finally {
    p.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("a failed sink never changes or replays the real operation", async () => {
  const dir = mkdtempSync(tmpdir() + "/gateway-profile-");
  const p = gatewayProfile(dir);
  try {
    const c = connection();
    const original = c.command;
    p.onConnection(c);
    fault.write = true;
    expect(await c.command("health")).toBe("normal reply");
    expect(original).toHaveBeenCalledTimes(1);
    expect(p.snapshot().failed).toBe(true);
  } finally {
    fault.write = false;
    p.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("refuses a symlink log without overwriting its target or changing work", async () => {
  const dir = mkdtempSync(tmpdir() + "/gateway-profile-");
  const target = dir + "/protected";
  writeFileSync(target, "preserved", { mode: 0o600 });
  symlinkSync(target, dir + "/qualification-profile.jsonl");
  const p = gatewayProfile(dir);
  try {
    const c = connection();
    p.onConnection(c);
    expect(await c.command("health")).toBe("normal reply");
    expect(p.snapshot().failed).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("preserved");
  } finally {
    p.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("bounds the observation log while continuing each real command once", async () => {
  const dir = mkdtempSync(tmpdir() + "/gateway-profile-");
  const p = gatewayProfile(dir);
  let calls = 0;
  try {
    for (let n = 0; n < 257; n++) {
      const c = connection();
      const original = c.command;
      p.onConnection(c);
      for (let i = 0; i < 128; i++) await c.command("health");
      calls += original.mock.calls.length;
    }
    expect(calls).toBe(257 * 128);
    expect(p.snapshot()).toMatchObject({
      truncated: true,
      failed: false,
    });
    expect(p.snapshot().records).toBeGreaterThan(32768);
    expect(p.snapshot().records).toBeLessThanOrEqual(65536);
    expect(statSync(p.snapshot().path).size).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(
      readFileSync(p.snapshot().path, "utf8").trim().split("\n"),
    ).toHaveLength(p.snapshot().records);
  } finally {
    p.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each(["partial", "full"])(
  "a %s prior log refuses profiling without changing work or prior bytes",
  async (mode) => {
    const dir = mkdtempSync(tmpdir() + "/gateway-profile-");
    const path = dir + "/qualification-profile.jsonl";
    const before =
      mode === "partial"
        ? Buffer.from('{"type":"capture"')
        : Buffer.alloc(8 * 1024 * 1024, 10);
    writeFileSync(path, before, { mode: 0o600 });
    const p = gatewayProfile(dir);
    try {
      expect(p.snapshot()).toMatchObject(
        mode === "partial" ? { failed: true } : { truncated: true },
      );
      const c = connection();
      const original = c.command;
      p.onConnection(c);
      expect(await c.command("health")).toBe("normal reply");
      expect(original).toHaveBeenCalledTimes(1);
      expect(readFileSync(path).equals(before)).toBe(true);
    } finally {
      p.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
