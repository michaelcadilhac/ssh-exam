import { afterEach, expect, it, vi } from "vitest";
import argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store, hash } from "../../apps/server/src/db.js";
import { AdministratorManagement } from "../../apps/server/src/administrator-management.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0)) close();
});
function fixture() {
  const dir = mkdtempSync(tmpdir() + "/administrator-service-");
  let store = new Store(dir);
  cleanups.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    service: () => new AdministratorManagement(store),
    restart: () => {
      store.close();
      store = new Store(dir);
    },
  };
}
const password = "synthetic-administrator-password";

it("uses the same slow verifier for account authentication and restart-safe scoped credential retries", async () => {
  const f = fixture();
  let service = f.service();
  const request = randomUUID(),
    input = { username: "helper", password, request };
  expect(await service.browserCreate(input, "owner", () => {})).toEqual({
    username: "helper",
  });
  const original = f.store.db
    .prepare("SELECT * FROM admins WHERE username='helper'")
    .get() as any;
  const intent = f.store.db
    .prepare("SELECT * FROM administrator_creation_requests")
    .get() as any;
  expect(JSON.parse(intent.fingerprint)).toEqual({
    purpose: "ssh-exam-administrator-intent/v1",
    username: "helper",
    verifier: original.hash,
  });
  expect(await argon2.verify(original.hash, password)).toBe(true);
  expect(intent.fingerprint).not.toContain(password);
  expect(intent.fingerprint).not.toContain(hash(password));
  expect(intent.result).toBe('{"username":"helper"}');
  f.restart();
  service = f.service();
  expect(await service.browserCreate(input, "owner", () => {})).toEqual({
    username: "helper",
  });
  await expect(
    service.browserCreate(
      { ...input, password: "different-synthetic-password" },
      "owner",
      () => {},
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
  await expect(
    service.browserCreate({ ...input, username: "other" }, "owner", () => {}),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(
    f.store.db.prepare("SELECT hash FROM admins WHERE username='helper'").get(),
  ).toEqual({ hash: original.hash });
  expect(
    f.store.db.prepare("SELECT * FROM audit WHERE action='create-admin'").all(),
  ).toHaveLength(1);
  expect(f.store.db.prepare("SELECT * FROM admins").all()).toHaveLength(1);
});

it("fences competing initial preparations and never guesses or recreates a vanished receipt", async () => {
  const f = fixture(),
    service = f.service(),
    request = randomUUID(),
    input = { username: "concurrent", password, request };
  const results = await Promise.allSettled([
    service.browserCreate(input, "owner", () => {}),
    service.browserCreate(input, "owner", () => {}),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toMatchObject([
    { reason: { statusCode: 409 } },
  ]);
  expect(await service.browserCreate(input, "owner", () => {})).toEqual({
    username: "concurrent",
  });
  const receipt = f.store.db
    .prepare("SELECT fingerprint FROM administrator_creation_requests")
    .get() as any;
  const prepared = await service.prepare(
    { username: input.username, password },
    receipt.fingerprint,
  );
  expect(() => service.assertReceipt(prepared)).toThrow(/receipt changed/);
  expect(() =>
    service.assertReceipt(prepared, receipt.fingerprint + " "),
  ).toThrow(/receipt changed/);
  expect(f.store.db.prepare("SELECT * FROM admins").all()).toHaveLength(1);
  expect(
    f.store.db.prepare("SELECT * FROM audit WHERE action='create-admin'").all(),
  ).toHaveLength(1);
});

it("rejects corrupt or oversized stored verifier parameters before any expensive verification", async () => {
  const f = fixture(),
    service = f.service();
  const verify = vi.spyOn(argon2, "verify");
  for (const receipt of [
    "{",
    "x".repeat(1025),
    JSON.stringify({
      purpose: "wrong",
      username: "helper",
      verifier: "secret",
    }),
    JSON.stringify({
      purpose: "ssh-exam-administrator-intent/v1",
      username: "helper",
      verifier:
        "$argon2id$v=19$m=999999999,t=3,p=1$" +
        "a".repeat(22) +
        "$" +
        "a".repeat(43),
    }),
  ]) {
    await expect(
      service.prepare({ username: "helper", password }, receipt),
    ).rejects.toMatchObject({ statusCode: 409 });
  }
  expect(verify).not.toHaveBeenCalled();
  expect(f.store.db.prepare("SELECT * FROM admins").all()).toHaveLength(0);
});

it("bounds actual hash preparation outside SQLite, wipes owned byte inputs and rechecks browser authorization", async () => {
  const f = fixture(),
    service = f.service();
  const digest = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
  });
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const captured: Buffer[] = [];
  const spy = vi.spyOn(argon2, "hash").mockImplementation(async (secret) => {
    expect(f.store.db.inTransaction).toBe(false);
    expect(Buffer.isBuffer(secret)).toBe(true);
    captured.push(secret as Buffer);
    await waiting;
    return digest;
  });
  let allowed = true;
  const authorize = () => {
    if (!allowed)
      throw Object.assign(Error("Authentication required"), {
        statusCode: 401,
      });
  };
  const first = service.browserCreate(
    { username: "first", password, request: randomUUID() },
    "owner",
    authorize,
  );
  const second = service.browserCreate(
    { username: "second", password, request: randomUUID() },
    "owner",
    authorize,
  );
  await expect(
    service.prepare({ username: "overloaded", password }),
  ).rejects.toMatchObject({ statusCode: 429 });
  expect(spy).toHaveBeenCalledTimes(2);
  expect(f.store.db.inTransaction).toBe(false);
  expect(f.store.db.prepare("SELECT 1 AS healthy").get()).toEqual({
    healthy: 1,
  });
  allowed = false;
  release();
  const results = await Promise.allSettled([first, second]);
  expect(results).toMatchObject([
    { status: "rejected", reason: { statusCode: 401 } },
    { status: "rejected", reason: { statusCode: 401 } },
  ]);
  expect(captured.every((b) => b.every((byte) => byte === 0))).toBe(true);
  expect(f.store.db.prepare("SELECT * FROM admins").all()).toHaveLength(0);
  expect(
    f.store.db.prepare("SELECT * FROM administrator_creation_requests").all(),
  ).toHaveLength(0);
  spy.mockRestore();
  expect(
    await service.browserCreate(
      { username: "recovered", password },
      "owner",
      () => {},
    ),
  ).toEqual({ username: "recovered" });
});

it("returns bounded metadata only and preserves UTF-16 password limits in both shared interfaces", async () => {
  const f = fixture(),
    service = f.service();
  for (const [username, secret] of [
    ["short", "😀".repeat(5)],
    ["long", "😀".repeat(513)],
  ]) {
    await expect(
      service.prepare({ username, password: secret }),
    ).rejects.toMatchObject({ statusCode: 400 });
  }
  await service.browserCreate(
    { username: "a_first", password: "😀".repeat(6) },
    "owner",
    () => {},
  );
  await service.browserCreate(
    { username: "z_last", password },
    "owner",
    () => {},
  );
  expect(service.page({ limit: 1 })).toEqual({
    administrators: [{ username: "a_first" }],
    next: "a_first",
  });
  expect(service.page({ limit: 1, after: "a_first" })).toEqual({
    administrators: [{ username: "z_last" }],
    next: null,
  });
  expect(service.show("a_first")).toEqual({
    username: "a_first",
    role: "admin",
  });
  expect(() => service.show("missing")).toThrow(/administrators list/);
  expect(() => service.page({ limit: 201 })).toThrow();
});

it("refuses a corrupted saved creation result instead of replaying private fields or another account", async () => {
  const f = fixture(),
    service = f.service(),
    request = randomUUID(),
    input = { username: "helper", password, request };
  await service.browserCreate(input, "owner", () => {});
  for (const result of [
    JSON.stringify({ username: "other" }),
    JSON.stringify({ username: "helper", hash: "PRIVATE-SYNTHETIC-VERIFIER" }),
    "{",
  ]) {
    f.store.db
      .prepare(
        "UPDATE administrator_creation_requests SET result=? WHERE request=?",
      )
      .run(result, request);
    await expect(
      service.browserCreate(input, "owner", () => {}),
    ).rejects.toMatchObject({ statusCode: 409 });
  }
  expect(
    f.store.db.prepare("SELECT * FROM audit WHERE action='create-admin'").all(),
  ).toHaveLength(1);
});
