import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../../apps/server/src/db.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";
import {
  nativeTemplateVersion,
  templateCatalogSync,
} from "../../packages/protocol/template-catalog.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function fixture() {
  const dir = mkdtempSync(tmpdir() + "/template-catalog-");
  const store = new Store(dir);
  cleanups.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, service: new TemplateCatalog(store, "class") };
}
const version = (hash = "a".repeat(64), name = "midterm") => ({
  schema: 1 as const,
  name,
  hash,
  entries: 4,
  files: 2,
  bytes: 30,
  max_file_bytes: 20,
  created: 1000,
});
const body = (hash = "a".repeat(64), name = "midterm") => ({
  version: version(hash, name),
  reason: "Reviewed synthetic immutable source",
});
const context = (issued = 10000, observed = 10010) => ({
  agent: "class",
  actor: "agent:class:root",
  request: randomUUID(),
  issued,
  observed,
});

it("persists metadata-only source observations without changing definition, enrollment, attempts or authority", () => {
  const { store, service } = fixture();
  const before = {
    exams: store.db.prepare("SELECT * FROM exams").all(),
    enrollments: store.db.prepare("SELECT * FROM enrollments").all(),
    attempts: store.db.prepare("SELECT * FROM attempts").all(),
  };
  const c = context();
  const synced = service.sync(body(), c);
  expect(synced).toMatchObject({
    agent: "class",
    updated: true,
    acknowledgement: {
      request: c.request,
      attested_at: c.issued,
      acknowledged_at: c.observed,
    },
    source: {
      name: "midterm",
      hash: version().hash,
      first_native_created: 1000,
      last_native_created: 1000,
      last_request: c.request,
    },
  });
  expect(synced.source.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(synced.note).toContain("NOT a live filesystem probe");
  expect(
    service.show({ name: "midterm", hash: version().hash }).source,
  ).toEqual(synced.source);
  expect({
    exams: store.db.prepare("SELECT * FROM exams").all(),
    enrollments: store.db.prepare("SELECT * FROM enrollments").all(),
    attempts: store.db.prepare("SELECT * FROM attempts").all(),
  }).toEqual(before);
  const audit = store.db
    .prepare("SELECT * FROM audit WHERE action='template-source-attested'")
    .get() as any;
  expect(audit.actor).toBe("agent:class:root");
  expect(audit.detail).toContain(c.request);
  expect(JSON.stringify(synced)).not.toContain("Reviewed synthetic");
  expect(
    store.db
      .prepare("SELECT version FROM schema_version WHERE version=20")
      .get(),
  ).toEqual({ version: 20 });
});

it("preserves immutable logical metadata, first observations and latest attestation across out-of-order receipts", () => {
  const { service } = fixture();
  const first = service.sync(body(), context(100, 200));
  const newer = context(300, 310);
  const changed = body();
  changed.version.created = 1500;
  const last = service.sync(changed, newer);
  expect(last.source.first_native_created).toBe(1000);
  expect(last.source.last_native_created).toBe(1500);
  expect(last.source.first_acknowledged_at).toBe(200);
  const delayed = context(250, 400);
  const older = service.sync(body(), delayed);
  expect(older.updated).toBe(false);
  expect(older.source).toEqual(last.source);
  expect(older.acknowledgement).toEqual({
    request: delayed.request,
    attested_at: 250,
    acknowledged_at: 400,
    native_created: 1000,
  });
  const wrong = body();
  wrong.version.bytes = 31;
  expect(() => service.sync(wrong, context(500, 510))).toThrow(
    /conflicts.*retained logical/,
  );
  expect(
    service.show({ name: "midterm", hash: version().hash }).source,
  ).toEqual(last.source);
  expect(first.source.revision).not.toBe(last.source.revision);
});

it("keeps timestamp zero and refuses non-root attribution, unknown payload fields and inconsistent counters", () => {
  const { store, service } = fixture();
  const synced = service.sync(body(), context(0, 0));
  expect(synced.source.first_acknowledged_at).toBe(0);
  expect(synced.source.last_attested_at).toBe(0);
  for (const extra of [
    { actor: "teacher" },
    { agent: "other" },
    { actor: "agent:other:root" },
  ])
    expect(() =>
      service.sync(body("b".repeat(64)), { ...context(), ...extra }),
    ).toThrow(/authenticated class root-agent/);
  for (const input of [
    { ...version(), path: "/private/DO-NOT-CACHE" },
    { ...version(), entries: 2 },
    { ...version(), files: 0 },
    { ...version(), bytes: 41 },
    { ...version(), max_file_bytes: 31 },
    { ...version(), created: 0 },
  ])
    expect(nativeTemplateVersion.safeParse(input).success).toBe(false);
  expect(
    templateCatalogSync.safeParse({ ...body(), actor: "spoof" }).success,
  ).toBe(false);
  expect(
    templateCatalogSync.safeParse({ ...body(), reason: "é".repeat(501) })
      .success,
  ).toBe(false);
  expect(
    templateCatalogSync.safeParse({ ...body(), reason: "é".repeat(4) }).success,
  ).toBe(true);
  expect(
    templateCatalogSync.safeParse({ ...body(), reason: "é".repeat(3) }).success,
  ).toBe(false);
  expect(
    store.db.prepare("SELECT count(*) n FROM agent_template_versions").get(),
  ).toEqual({ n: 1 });
});

it("pages by exact name/hash and agent using the composite index without private payloads or filesystem IO", () => {
  const { store, service } = fixture();
  for (const [name, h] of [
    ["a", "a"],
    ["a", "b"],
    ["b", "a"],
  ])
    service.sync(body(h.repeat(64), name), context());
  const foreign = new TemplateCatalog(store, "other");
  foreign.sync(body("c".repeat(64), "a"), {
    ...context(),
    agent: "other",
    actor: "agent:other:root",
  });
  const first = service.page({ limit: 1 });
  expect(first.sources.map((v) => v.name)).toEqual(["a"]);
  expect(first.next).toBe("a@" + "a".repeat(64));
  const second = service.page({ limit: 1, after: first.next! });
  expect(second.sources[0].hash).toBe("b".repeat(64));
  const filtered = service.page({
    limit: 1,
    name: "a",
    after: second.sources[0].name + "@" + second.sources[0].hash,
  });
  expect(filtered.sources).toEqual([]);
  expect(filtered.next).toBeNull();
  expect(service.page({ limit: 200 }).sources).toHaveLength(3);
  expect(() => service.page({ limit: 201 })).toThrow();
  expect(() => service.page({ after: randomUUID() })).toThrow();
  const plan = store.db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM agent_template_versions WHERE agent=? AND (name,hash)>(?,?) ORDER BY name,hash LIMIT ?",
    )
    .all("class", "a", "", 2);
  expect(JSON.stringify(plan)).toContain(
    "USING INDEX sqlite_autoindex_agent_template_versions_1",
  );
});

it("rolls back source registration when its required audit fails", () => {
  const { store, service } = fixture();
  const audit = vi.spyOn(store, "audit").mockImplementation(() => {
    throw Error("synthetic audit persistence failure");
  });
  expect(() => service.sync(body(), context())).toThrow(/audit persistence/);
  expect(
    store.db.prepare("SELECT count(*) n FROM agent_template_versions").get(),
  ).toEqual({ n: 0 });
  audit.mockRestore();
  expect(service.sync(body(), context()).updated).toBe(true);
});
