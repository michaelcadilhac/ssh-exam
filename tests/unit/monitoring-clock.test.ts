import { expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMonitoringBootClock,
  monitoringBootTimeMS,
  MonitoringBootClockUnavailable,
} from "../../apps/server/src/monitoring-clock.js";
import {
  MonitoringEvidenceLedger,
  MonitoringEvidenceUnavailable,
} from "../../apps/server/src/monitoring-evidence-ledger.js";

const owner = JSON.parse(
  readFileSync(
    new URL("../fixtures/monitoring-evidence.json", import.meta.url),
    "utf8",
  ),
).owner;
const ready = {
  fullscreen: true,
  visible: true,
  keyboard: true,
  screen: true,
  webcam: true,
  focus: true,
};

it("reads actual Linux boot elapsed milliseconds, independent of wall time and process restart", () => {
  // /proc is only a coarse independent test observation, never an auth clock.
  const before =
    Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * 1000;
  const wall = vi.spyOn(Date, "now").mockReturnValue(0);
  let now: number;
  try {
    now = monitoringBootTimeMS();
  } finally {
    wall.mockRestore();
  }
  const after =
    Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * 1000;
  expect(Number.isSafeInteger(now)).toBe(true);
  expect(now).toBeGreaterThanOrEqual(before - 20);
  expect(now).toBeLessThanOrEqual(after + 20);
  const module = fileURLToPath(
    new URL("../../apps/server/native/monitoring_clock.node", import.meta.url),
  );
  const child = Number(
    execFileSync(
      process.execPath,
      [
        "-e",
        'const c=require(process.argv[1]);if(c.kind!=="linux-boottime-ms-v1")process.exit(1);process.stdout.write(String(c.now()))',
        module,
      ],
      { encoding: "utf8", timeout: 3000 },
    ),
  );
  expect(child).toBeGreaterThanOrEqual(now);
  expect(monitoringBootTimeMS()).toBeGreaterThanOrEqual(child);
});

it("rejects unknown/absent native APIs and invalid values without approximate fallback or private errors", () => {
  const values: unknown[] = [
    null,
    undefined,
    {},
    { kind: "performance", now: () => 123 },
    { kind: "linux-boottime-ms-v1", now: 1 },
  ];
  for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    values.push({ kind: "linux-boottime-ms-v1", now: () => value });
  values.push({
    kind: "linux-boottime-ms-v1",
    now: () => {
      throw new Error("PRIVATE-SYSCALL");
    },
  });
  for (const value of values) {
    const clock = createMonitoringBootClock(() => value);
    expect(clock).toThrow(MonitoringBootClockUnavailable);
    try {
      clock();
    } catch (error) {
      expect(String(error)).not.toMatch(/PRIVATE|SYSCALL/);
    }
  }
  const missing = createMonitoringBootClock(() => {
    throw new Error("PRIVATE-MODULE-PATH");
  });
  expect(missing).toThrow(MonitoringBootClockUnavailable);
  try {
    missing();
  } catch (error) {
    expect(String(error)).not.toContain("PRIVATE");
  }
});

it("loads one verified native reader and preserves exact integer output", () => {
  let loads = 0,
    now = 123;
  const clock = createMonitoringBootClock(() => {
    loads++;
    return { kind: "linux-boottime-ms-v1", now: () => now };
  });
  expect(clock()).toBe(123);
  now = Number.MAX_SAFE_INTEGER;
  expect(clock()).toBe(Number.MAX_SAFE_INTEGER);
  expect(loads).toBe(1);
});

it("uses the actual native clock in the unused default ledger and rejects clock errors as technical uncertainty", () => {
  const live = new MonitoringEvidenceLedger("class");
  const binding = live.registerTrustedOwner(owner, true);
  for (const source of ["screen", "webcam"] as const)
    live.confirmValidatedFrame(
      binding,
      live.issueBrowserChallenge(binding, source),
      source,
      1,
    );
  live.confirmPolicy(
    binding,
    live.issueBrowserChallenge(binding, "policy"),
    ready,
  );
  expect(live.inspect(binding)).toMatchObject({ state: "fresh", gaps: 0 });

  let failed = false;
  const ledger = new MonitoringEvidenceLedger("class", () => {
    if (failed) throw new Error("PRIVATE-CLOCK");
    return 1000;
  });
  const synthetic = ledger.registerTrustedOwner(owner, false);
  failed = true;
  expect(() => ledger.inspect(synthetic)).toThrow(
    MonitoringEvidenceUnavailable,
  );
  try {
    ledger.inspect(synthetic);
  } catch (error) {
    expect(error).toMatchObject({ kind: "clock" });
    expect(String(error)).not.toMatch(/PRIVATE|policy-blocked/);
  }
});

it("qualifies exact native conversion bounds under undefined-behavior sanitizer", () => {
  const temporary = mkdtempSync(
    path.join(tmpdir(), "ssh-exam-clock-arithmetic-"),
  );
  try {
    const binary = path.join(temporary, "clock-test");
    execFileSync(
      process.env.EXAM_CLOCK_CC || "gcc",
      [
        "-std=c11",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-fsanitize=undefined",
        "-fno-sanitize-recover=undefined",
        fileURLToPath(
          new URL("../native/monitoring_clock_test.c", import.meta.url),
        ),
        "-o",
        binary,
      ],
      { timeout: 10000 },
    );
    execFileSync(binary, [], { timeout: 3000 });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
