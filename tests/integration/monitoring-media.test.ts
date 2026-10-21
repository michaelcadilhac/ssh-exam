import { expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  linkSync,
  mkdirSync,
  truncateSync,
  renameSync,
} from "node:fs";
import { fork, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { mediaFixture } from "../fixtures/monitoring-media.js";
import { MonitoringMedia } from "../../apps/server/src/monitoring-media.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";

it("serves bounded original/thumbnail bytes only to admins, with no-store and strict scope", async () => {
  const dir = mkdtempSync(tmpdir() + "/monitoring-media-");
  const f = await mediaFixture(dir);
  try {
    const before = f.store.attempt("a");
    const full = await f.app.inject({ url: f.url, headers: f.headers });
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload).toEqual(f.data);
    expect(full.headers["cache-control"]).toContain("no-store");
    expect(full.headers["content-type"]).toContain("image/jpeg");
    expect(
      (await f.app.inject({ url: f.url + "?thumbnail=1", headers: f.headers }))
        .rawPayload,
    ).toEqual(readFileSync(f.thumbnail));
    expect((await f.app.inject({ url: f.url })).statusCode).toBe(401);
    const student = f.store.session("student", "synthetic", "e");
    expect(
      (
        await f.app.inject({
          url: f.url,
          headers: { cookie: `session=${student.token}` },
        })
      ).statusCode,
    ).toBe(401); // Existing principal policy rejects the wrong role as unauthenticated.
    for (const query of ["?thumbnail=2", "?other=1"])
      expect(
        (await f.app.inject({ url: f.url + query, headers: f.headers }))
          .statusCode,
      ).toBe(400);
    expect(
      (
        await f.app.inject({
          url: `/api/admin/media/${randomUUID()}`,
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(f.store.attempt("a")).toEqual(before);
    expect(
      f.store.db
        .prepare("SELECT COUNT(*) AS n FROM audit WHERE action='view-media'")
        .get(),
    ).toEqual({ n: 2 });
  } finally {
    await f.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rechecks deletion after asynchronous image reads finish, before sending private bytes", async () => {
  const dir = mkdtempSync(tmpdir() + "/monitoring-media-");
  const f = await mediaFixture(dir);
  const original = MonitoringMedia.prototype.read;
  const spy = vi
    .spyOn(MonitoringMedia.prototype, "read")
    .mockImplementationOnce(async function (this: MonitoringMedia, ...args) {
      const result = await original.apply(this, args);
      new Monitoring(f.store).delete("a", "teacher");
      return result;
    });
  try {
    const before = f.store.attempt("a");
    const refused = await f.app.inject({ url: f.url, headers: f.headers });
    expect(refused.statusCode).toBe(410);
    expect(refused.rawPayload).not.toEqual(f.data);
    expect(f.store.attempt("a")).toEqual(before);
    expect(
      f.store.db.prepare("SELECT 1 FROM tombstones WHERE attempt='a'").get(),
    ).toBeTruthy();
  } finally {
    spy.mockRestore();
    await f.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("refuses real FIFO images without stalling another HTTP request in an owned disposable server", async () => {
  const dir = mkdtempSync(tmpdir() + "/monitoring-media-child-");
  const child = fork(
    new URL("../fixtures/media-gateway.ts", import.meta.url),
    [dir],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    const ready = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("media fixture startup timed out")),
        5000,
      );
      child.once("error", reject);
      child.once("exit", () =>
        reject(Error("media fixture exited before readiness")),
      );
      child.once("message", (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    for (const [path, query] of [
      [ready.path, ""],
      [ready.thumbnail, "?thumbnail=1"],
    ]) {
      expect(path.startsWith(dir + "/monitoring/a/")).toBe(true);
      unlinkSync(path);
      execFileSync("mkfifo", [path]);
      const [refused, healthy] = await Promise.all([
        fetch(ready.origin + ready.url + query, {
          headers: ready.headers,
          signal: AbortSignal.timeout(1500),
        }),
        fetch(ready.origin + "/health/live", {
          signal: AbortSignal.timeout(1500),
        }),
      ]);
      expect(refused.status).toBe(503);
      expect(await refused.text()).not.toContain(dir);
      expect(healthy.status).toBe(200);
      expect(await healthy.json()).toEqual({ ok: true });
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
});

it("refuses linked, special, oversized, altered and redirected stored images without exposing protected bytes", async () => {
  const dir = mkdtempSync(tmpdir() + "/monitoring-media-");
  const f = await mediaFixture(dir);
  const protectedPath = `${dir}/submissions/immutable`;
  writeFileSync(protectedPath, "PRIVATE-PROTECTED-BYTES", { mode: 0o600 });
  try {
    const before = f.store.attempt("a");
    for (const [path, query, limit] of [
      [f.path, "", 1500000],
      [f.thumbnail, "?thumbnail=1", 2 * 1024 * 1024],
    ] as const) {
      const original = readFileSync(path);
      for (const corrupt of [
        () => symlinkSync(protectedPath, path),
        () => linkSync(protectedPath, path),
        () => mkdirSync(path, { mode: 0o700 }),
        () => writeFileSync(path, "", { mode: 0o600 }),
        () => {
          writeFileSync(path, "", { mode: 0o600 });
          truncateSync(path, limit + 1);
        },
      ]) {
        unlinkSync(path);
        corrupt();
        const refused = await f.app.inject({
          url: f.url + query,
          headers: f.headers,
        });
        expect(refused.statusCode).toBe(503);
        expect(refused.body).toContain("Monitoring image read refused");
        expect(refused.body).not.toContain("PRIVATE-PROTECTED");
        expect(refused.body).not.toContain(dir);
        rmSync(path, { recursive: true, force: true });
        writeFileSync(path, original, { mode: 0o600 });
      }
    }
    writeFileSync(f.path, "tampered");
    expect(
      (await f.app.inject({ url: f.url, headers: f.headers })).json().error,
    ).toContain("digest");
    writeFileSync(f.path, f.data);
    for (const path of [`${dir}/monitoring/a`, `${dir}/monitoring`]) {
      renameSync(path, path + "-original");
      symlinkSync(path + "-original", path);
      const refused = await f.app.inject({ url: f.url, headers: f.headers });
      expect(refused.statusCode).toBe(503);
      expect(refused.body).not.toContain(dir);
      unlinkSync(path);
      renameSync(path + "-original", path);
    }
    unlinkSync(f.path);
    expect(
      (await f.app.inject({ url: f.url, headers: f.headers })).statusCode,
    ).toBe(503);
    expect(readFileSync(protectedPath, "utf8")).toBe("PRIVATE-PROTECTED-BYTES");
    expect(f.store.attempt("a")).toEqual(before);
  } finally {
    await f.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
