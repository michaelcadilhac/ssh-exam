import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../../apps/server/src/db.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
const version = "a".repeat(64),
  other = "b".repeat(64);
function fixture() {
  const data = mkdtempSync(tmpdir() + "/exam-version-");
  const store = new Store(data);
  cleanups.push(() => {
    store.close();
    rmSync(data, { recursive: true, force: true });
  });
  const attest = (agent: string, name: string, hash: string) =>
    new TemplateCatalog(store, agent).sync(
      {
        version: {
          schema: 1,
          name,
          hash,
          entries: 4,
          files: 2,
          bytes: 30,
          max_file_bytes: 20,
          created: 1000,
        },
        reason: "Reviewed synthetic immutable source",
      },
      {
        agent,
        actor: `agent:${agent}:root`,
        request: randomUUID(),
        issued: 1000,
        observed: 1010,
      },
    );
  return { store, attest, definitions: new ExamDefinitions(store, "class") };
}
const exam = () => ({
  id: "midterm",
  name: "Midterm",
  template: "v1",
  template_version: version,
  duration: 5400,
  webcam: true,
  terminals: 4,
  earliest: Date.now() - 60000,
  latest: Date.now() + 60000,
});

it("selects only the configured agent's exact attested name/hash and preserves saved preparations", () => {
  const { store, attest, definitions } = fixture();
  attest("class", "v1", version);
  const saved = definitions.create(exam(), "operator");
  expect(saved.exam.template_version).toBe(version);
  const settings = JSON.stringify(saved.exam);
  store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('prepared','midterm','student',10001,'PREPARING',?)",
    )
    .run(settings);
  attest("class", "v1", other);
  const changed = definitions.update(
    "midterm",
    { template_version: other },
    saved.revision,
    "operator",
  );
  expect(changed.exam.template_version).toBe(other);
  expect(store.attempt("prepared").settings).toBe(settings);
  const legacy = definitions.update(
    "midterm",
    { template_version: "" },
    changed.revision,
    "operator",
  );
  expect(legacy.exam).not.toHaveProperty("template_version");
  expect(store.attempt("prepared").settings).toBe(settings);
});

it("refuses unknown, wrong-name, wrong-agent and malformed selections without a default or audit write", () => {
  const { store, attest, definitions } = fixture();
  attest("class", "other-name", version);
  attest("other-agent", "v1", version);
  for (const selected of [version, other, "latest", "A".repeat(64)]) {
    const before = store.db.prepare("SELECT * FROM audit").all();
    expect(() =>
      definitions.create({ ...exam(), template_version: selected }, "operator"),
    ).toThrow();
    expect(
      store.db.prepare("SELECT * FROM exams WHERE id='midterm'").get(),
    ).toBeUndefined();
    expect(store.db.prepare("SELECT * FROM audit").all()).toEqual(before);
  }
  attest("class", "v1", version);
  const saved = definitions.create(exam(), "operator");
  expect(() =>
    definitions.update(
      "midterm",
      { template: "renamed" },
      saved.revision,
      "operator",
    ),
  ).toThrow(/attestation|exact/i);
  expect(definitions.show("midterm")).toEqual(saved);
});

it("preserves exact sandbox source selection alongside its finite normalized practice policy", () => {
  const { attest, definitions } = fixture();
  attest("class", "v1", version);
  const result = definitions.create({ ...exam(), id: "sandbox" }, "operator");
  expect(result.exam).toMatchObject({
    id: "sandbox",
    duration: 300,
    webcam: false,
    template: "v1",
    template_version: version,
  });
});
