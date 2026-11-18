import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRemoteStressHeadroom } from "../fixtures/stress-generator-status.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});
async function statusFile(value: unknown) {
  const directory = await mkdtemp(join(tmpdir(), "stress-status-"));
  directories.push(directory);
  const path = join(directory, "generator-status.json");
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  return path;
}
function healthy() {
  return {
    host: "marco",
    active: true,
    observed_local_ms: Date.now() - 1,
    available_bytes: 5 * 1024 ** 3,
    minimum_available_bytes: 4 * 1024 ** 3,
  };
}

describe("actual cohort generator status reader", () => {
  it("accepts a fresh healthy observation through the real status file", async () => {
    expect(await readRemoteStressHeadroom(await statusFile(healthy()))).toBe(5 * 1024 ** 3);
  });

  it("reports the saved refusal without requiring missing healthy fields", async () => {
    const { available_bytes: _, ...identity } = healthy();
    const path = await statusFile({
      ...identity,
      active: false,
      error: "Marco generator resource/readiness guard refused: owned browser unit is not running",
      refused_observation: { active: false, unit_state: { ActiveState: "inactive" } },
    });
    await expect(readRemoteStressHeadroom(path)).rejects.toThrow(
      /generator stopped:.*unit is not running.*journal on Marco/,
    );
  });

  it("keeps an old inactive observation unavailable even without an error message", async () => {
    await expect(
      readRemoteStressHeadroom(await statusFile({ ...healthy(), active: false, observed_local_ms: 0 })),
    ).rejects.toThrow("owned unit unavailable");
  });

  it.each([
    { observed_local_ms: Date.now() + 60000 },
    { observed_local_ms: 0 },
    { available_bytes: 4 * 1024 ** 3 - 1 },
    { available_bytes: -1 },
    { available_bytes: undefined },
    { host: "unrelated-host" },
    { minimum_available_bytes: 0 },
    { active: "true" },
  ])("refuses stale, changed or insufficient status: %j", async (change) => {
    await expect(readRemoteStressHeadroom(await statusFile({ ...healthy(), ...change }))).rejects.toThrow(
      /Remote browser generator (status is invalid|health\/headroom is unavailable)/,
    );
  });
});
