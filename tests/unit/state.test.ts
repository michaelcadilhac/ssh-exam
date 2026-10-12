import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";
const stores: Store[] = [];
afterEach(() => {
  for (const s of stores) {
    s.close();
    rmSync(s.dir, { recursive: true, force: true });
  }
  stores.length = 0;
});
function setup() {
  const s = new Store(mkdtempSync(tmpdir() + "/exam-state-"));
  stores.push(s);
  s.db.prepare("INSERT INTO exams VALUES(?,?)").run("exam", "{}");
  s.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,deadline) VALUES(?,?,?,?,'ACTIVE','{}',?)",
    )
    .run("first", "exam", "alice", 1001, Date.now() + 5400000);
  return s;
}
describe("durable attempt state", () => {
  it("preserves deadline through lock/continue", () => {
    const s = setup(),
      deadline = s.attempt("first").deadline;
    s.transition("first", ["ACTIVE"], "LOCKED");
    s.transition("first", ["LOCKED"], "ACTIVE");
    expect(s.attempt("first").deadline).toBe(deadline);
  });
  it("rejects unauthorized state transitions", () => {
    const s = setup();
    expect(() => s.transition("first", ["LOCKED"], "ACTIVE")).toThrow();
    s.transition("first", ["ACTIVE"], "COMPLETED");
    expect(() => s.transition("first", ["LOCKED"], "ACTIVE")).toThrow();
  });
  it("allows only one busy attempt per UID across exams", () => {
    const s = setup();
    s.db.prepare("INSERT INTO exams VALUES(?,?)").run("other", "{}");
    expect(() =>
      s.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('second','other','alice',1001,'PREPARING','{}')",
        )
        .run(),
    ).toThrow();
  });
  it("does not release failed collection account guard", () => {
    const s = setup();
    s.transition("first", ["ACTIVE"], "COLLECTION_FAILED");
    expect(() =>
      s.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('second','exam','bob',1001,'PREPARING','{}')",
        )
        .run(),
    ).toThrow();
  });
});

it("successful early completion remains a per-UID reservation until remote access release", () => {
  const s = setup();
  s.db.prepare("INSERT INTO exams VALUES('other','{}')").run();
  s.db
    .prepare(
      "UPDATE attempts SET state='COMPLETED',protected=1,access_state='HELD',start=?,deadline=? WHERE id='first'",
    )
    .run(Date.now(), Date.now() + 5400000);
  expect(() =>
    s.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('second','other','alice',1001,'PREPARING','{}')",
      )
      .run(),
  ).toThrow(/restricted/);
  s.db
    .prepare("UPDATE attempts SET access_state='RELEASED' WHERE id='first'")
    .run();
  expect(() =>
    s.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('second','other','alice',1001,'PREPARING','{}')",
      )
      .run(),
  ).not.toThrow();
});
