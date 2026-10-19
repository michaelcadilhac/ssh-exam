import { expect, it } from "vitest";
import { Store } from "../../apps/server/src/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
it("upgrades historical attempts without inventing preflight dates and preserves newly recorded dates on restart", () => {
  const dir = mkdtempSync(tmpdir() + "/preflight-dates-");
  let s = new Store(dir);
  try {
    s.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
    s.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,ended) VALUES('old','e','alice',1001,'COMPLETED','{}',1000,2000)",
      )
      .run();
    s.db.exec(
      "ALTER TABLE attempts DROP COLUMN preflight_started_at; DELETE FROM schema_version WHERE version=10",
    );
    s.close();
    s = new Store(dir);
    expect(s.attempt("old")).toMatchObject({
      preflight_started_at: null,
      start: 1000,
      ended: 2000,
    });
    s.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,preflight_started_at) VALUES('new','e','bob',1002,'PREPARING','{}',1234)",
      )
      .run();
    s.close();
    s = new Store(dir);
    expect(s.attempt("new").preflight_started_at).toBe(1234);
    expect(
      s.db.prepare("SELECT version FROM schema_version WHERE version=10").all(),
    ).toHaveLength(1);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
