import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { examSchema } from "../../packages/protocol/index.js";

const exam = {
  id: "limits",
  name: "Collection limits",
  earliest: 1,
  latest: 1000000,
  template: "v1",
};

it("validates logical MiB defaults, integer bounds and the complete file/total pair", () => {
  expect(examSchema.parse(exam)).toMatchObject({
    collection_file_mib: 128,
    collection_total_mib: 512,
  });
  for (const invalid of [
    { collection_file_mib: 0 },
    { collection_file_mib: 1.5 },
    { collection_file_mib: 4097 },
    { collection_total_mib: 16385 },
    { collection_file_mib: 256, collection_total_mib: 128 },
  ]) {
    expect(() => examSchema.parse({ ...exam, ...invalid })).toThrow();
  }
});

it("shares revisioned limit changes without rewriting existing snapshots or weakening sandbox policy", () => {
  const dir = mkdtempSync(tmpdir() + "/collection-settings-");
  const store = new Store(dir);
  try {
    const definitions = new ExamDefinitions(store);
    const created = definitions.create(exam, "teacher");
    const historical = JSON.stringify({
      ...created.exam,
      template: "frozen-v0",
    });
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,access_state) VALUES('prior','limits','synthetic',1001,'COMPLETED',?,100,200,300,'HELD')",
      )
      .run(historical);
    const changed = definitions.update(
      exam.id,
      { collection_file_mib: 256, collection_total_mib: 1024 },
      created.revision,
      "agent:class:root",
      "Explicit larger artifact allowance",
    );
    const renamed = definitions.update(
      exam.id,
      { name: "Renamed" },
      changed.revision,
      "teacher",
    );
    expect(renamed.exam).toMatchObject({
      collection_file_mib: 256,
      collection_total_mib: 1024,
    });
    expect(() =>
      definitions.update(
        exam.id,
        { collection_total_mib: 128 },
        renamed.revision,
        "teacher",
      ),
    ).toThrow("total must be at least");
    expect(definitions.show(exam.id)).toEqual(renamed);
    expect(() =>
      definitions.update(
        exam.id,
        { collection_file_mib: 128 },
        created.revision,
        "teacher",
      ),
    ).toThrow("changed");
    expect(store.attempt("prior")).toMatchObject({
      settings: historical,
      start: 100,
      deadline: 200,
      original_deadline: 300,
      access_state: "HELD",
    });
    const sandbox = definitions.create(
      {
        ...exam,
        id: "sandbox",
        duration: 21600,
        webcam: true,
        terminals: 1,
        collection_file_mib: 64,
        collection_total_mib: 256,
      },
      "teacher",
    );
    expect(sandbox.exam).toMatchObject({
      duration: 300,
      webcam: false,
      terminals: 4,
      collection_file_mib: 64,
      collection_total_mib: 256,
    });
    expect(
      store.db
        .prepare(
          "SELECT actor,detail FROM audit WHERE actor='agent:class:root'",
        )
        .get(),
    ).toMatchObject({
      actor: "agent:class:root",
      detail: expect.stringContaining("Explicit larger artifact allowance"),
    });
    expect(store.db.pragma("foreign_key_check")).toEqual([]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
