import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";
import {
  SANDBOX_EXAM_ID,
  sandboxExam,
  isSandbox,
} from "../../packages/protocol/sandbox.js";

it("reserves a recognizable sandbox ID and fixed five-minute configuration", () => {
  expect(SANDBOX_EXAM_ID).toBe("sandbox");
  expect(sandboxExam()).toMatchObject({
    id: "sandbox",
    name: "sandbox",
    duration: 300,
  });
  expect(isSandbox("sandbox-copy")).toBe(false);
  expect(sandboxExam().latest).toBeLessThan(Date.now());
  expect(sandboxExam("v1", { earliest: 100, latest: 200 })).toMatchObject({
    earliest: 100,
    latest: 200,
    duration: 300,
    webcam: false,
  });
});

it("migrates old submissions and foreign keys while allowing sandbox history only", () => {
  const dir = mkdtempSync(tmpdir() + "/sandbox-migration-");
  let db = new Database(`${dir}/metadata.sqlite`);
  for (const n of [1, 2, 3, 4])
    db.exec(readFileSync(`migrations/00${n}.sql`, "utf8"));
  db.exec(
    "INSERT INTO exams VALUES('sandbox','{}'),('ordinary','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,checksum) VALUES('old','sandbox','alice',1001,'COMPLETED','{}','checksum'); INSERT INTO incidents(id,attempt,generation,opened,events) VALUES('incident','old',0,1,'[]');",
  );
  db.close();
  const store = new Store(dir);
  db = store.db;
  try {
    expect(store.attempt("old").checksum).toBe("checksum");
    expect(db.pragma("foreign_key_check")).toEqual([]);
    const insert = db.prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES(?,?,?,?,?,'{}')",
    );
    insert.run("repeat", "sandbox", "alice", 1001, "COMPLETED");
    insert.run("normal", "ordinary", "alice", 1001, "COMPLETED");
    expect(() =>
      insert.run("normal-again", "ordinary", "alice", 1001, "COMPLETED"),
    ).toThrow();
    insert.run("active", "sandbox", "alice", 1001, "PREPARING");
    expect(() =>
      insert.run("overlap", "sandbox", "alice", 1001, "PREPARING"),
    ).toThrow();
    expect(db.prepare("SELECT attempt FROM incidents").get()).toEqual({
      attempt: "old",
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
