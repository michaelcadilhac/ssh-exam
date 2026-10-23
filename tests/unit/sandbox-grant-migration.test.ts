import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";

it("027 preserves legacy practice and fences grantless writers across accounts after activation", () => {
  const dir = mkdtempSync(tmpdir() + "/sandbox-grant-migration-");
  let db = new Database(`${dir}/metadata.sqlite`);
  let store: Store | undefined;
  try {
    for (const name of readdirSync("migrations")
      .filter((n) => /^\d{3}\.sql$/.test(n) && Number(n.slice(0, 3)) <= 26)
      .sort())
      db.exec(readFileSync(`migrations/${name}`, "utf8"));
    const digest = "a".repeat(64),
      settings = JSON.stringify({
        id: "sandbox",
        name: "Practice",
        template: "v1",
        template_version: digest,
        duration: 300,
        webcam: false,
        terminals: 4,
        earliest: 100,
        latest: 10000,
      });
    db.prepare("INSERT INTO exams VALUES('sandbox',?)").run(settings);
    db.prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('old','sandbox','olduser',10001,'PREPARING',?)",
    ).run(settings);
    const old = db.prepare("SELECT * FROM attempts WHERE id='old'").get();
    db.close();
    store = new Store(dir);
    db = store.db;
    expect(db.prepare("SELECT * FROM attempts WHERE id='old'").get()).toEqual(
      old,
    );
    expect(
      db.prepare("SELECT version FROM schema_version WHERE version=27").get(),
    ).toEqual({ version: 27 });
    db.prepare(
      "INSERT INTO attempt_grants(rowid,id,agent,exam,username,revision,status,issued_at,actor,reason,issuance) VALUES(42,'grant','class','sandbox','student',1,'AVAILABLE',1000,'policy:sandbox','Finite practice','PRACTICE')",
    ).run();
    db.prepare("INSERT INTO grant_revisions VALUES('grant',1,?,?,?,?,?,?)").run(
      settings,
      JSON.stringify({ kind: "template", name: "v1", hash: digest }),
      digest,
      "policy:sandbox",
      "Finite practice",
      1000,
    );
    const legacy = db.prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES(?,'sandbox','another',10002,?,?)",
    );
    for (const state of ["PREPARING", "ACTIVATING", "ACTIVE", "LOCKED"])
      expect(() => legacy.run(`blocked-${state}`, state, settings)).toThrow(
        "Saved practice grant required",
      );
    legacy.run("historical", "COMPLETED", settings);
    db.prepare(
      "INSERT INTO grant_claims VALUES('new','grant',1,?,10003,'PREPARING',1000,NULL)",
    ).run(digest);
    const prepared = db.prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,grant_id,grant_revision,grant_hash,grant_kind,grant_issued_order) VALUES('new','sandbox','student',10003,'PREPARING',?,'grant',1,?,?,42)",
    );
    expect(() => prepared.run(settings, digest, "ADDITIONAL")).toThrow(
      "Grant-aware preparation required",
    );
    prepared.run(settings, digest, "PRACTICE");
    expect(() =>
      db
        .prepare("UPDATE attempts SET grant_kind='ADDITIONAL' WHERE id='new'")
        .run(),
    ).toThrow("immutable");
    expect(db.pragma("foreign_key_check")).toEqual([]);
    store.close();
    store = new Store(dir);
    db = store.db;
    expect(db.prepare("SELECT * FROM attempts WHERE id='old'").get()).toEqual(
      old,
    );
    expect(
      db
        .prepare(
          "SELECT grant_kind,grant_issued_order FROM attempts WHERE id='new'",
        )
        .get(),
    ).toEqual({ grant_kind: "PRACTICE", grant_issued_order: 42 });
  } finally {
    if (store) store.close();
    else if (db.open) db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
