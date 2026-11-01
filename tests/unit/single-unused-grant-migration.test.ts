import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";

function fixture() {
  const dir = mkdtempSync(tmpdir() + "/single-unused-grant-migration-"),
    file = `${dir}/metadata.sqlite`;
  const db = new Database(file);
  db.pragma("foreign_keys = OFF"); // Existing rebuild migrations preserve their own FKs.
  for (const name of readdirSync("migrations")
    .filter((n) => /^\d{3}\.sql$/.test(n) && Number(n.slice(0, 3)) <= 35)
    .sort())
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  db.pragma("foreign_keys = ON");
  const digest = "a".repeat(64),
    settings = {
      id: "e",
      name: "Migration exam",
      template: "sample",
      template_version: digest,
      duration: 5400,
      webcam: true,
      terminals: 4,
      earliest: 100,
      latest: 200,
    };
  db.prepare("INSERT INTO exams VALUES('e',?)").run(JSON.stringify(settings));
  const grant = (
    id: string,
    order: number,
    status = "AVAILABLE",
    username = "alice",
    earliest = 100,
    latest = 200,
    agent = "class",
  ) => {
    const saved = JSON.stringify({ ...settings, earliest, latest });
    db.prepare(
      "INSERT INTO attempt_grants(rowid,id,agent,exam,username,revision,status,issued_at,actor,reason,issuance) VALUES(?,?,?,'e',?,1,?,?,'instructor','Original permission','ADDITIONAL_TEMPLATE')",
    ).run(order, id, agent, username, status, 100000 - order);
    db.prepare("INSERT INTO grant_revisions VALUES(?,1,?,?,?,?,?,?)").run(
      id,
      saved,
      JSON.stringify({ kind: "template", name: "sample", hash: digest }),
      digest,
      "instructor",
      "Original saved settings",
      100000 - order,
    );
  };
  const claim = (id: string, grant: string, state = "CANCELLED") =>
    db
      .prepare("INSERT INTO grant_claims VALUES(?,?,1,?,10001,?,1000,1001)")
      .run(id, grant, digest, state);
  const snapshot = () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    return Object.fromEntries(
      tables.map(({ name }) => [
        name,
        db
          .prepare(
            `SELECT rowid AS preserved_rowid,* FROM "${name}" ORDER BY rowid`,
          )
          .all(),
      ]),
    );
  };
  return { dir, file, db, digest, settings, grant, claim, snapshot };
}

it("036 keeps the newest unused row across disjoint expired windows and mixed source readiness without changing retained history", () => {
  const f = fixture();
  let store: Store | undefined;
  try {
    f.grant("older", 42, "AVAILABLE");
    f.grant("newest", 99, "PENDING_NATIVE", "alice", 300, 400);
    f.grant("consumed", 7);
    f.grant("revoked", 120, "REVOKED");
    f.grant("another-student", 150, "AVAILABLE", "bob");
    f.grant("another-agent", 151, "AVAILABLE", "alice", 100, 200, "other");
    f.claim("cancelled-setup", "older");
    f.db
      .prepare(
        "INSERT INTO grant_begin_intents(id,attempt,transport,state,created_at) VALUES('cancelled-begin','cancelled-setup','ssh-a','CANCELLED',1000)",
      )
      .run();
    f.claim("historical", "consumed", "PREPARING");
    f.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,grant_id,grant_revision,grant_hash,grant_kind,grant_issued_order) VALUES('historical','e','alice',10001,'PREPARING',?,'consumed',1,?,'ADDITIONAL',7)",
      )
      .run(JSON.stringify(f.settings), f.digest);
    f.db
      .prepare(
        "UPDATE attempt_grants SET status='CONSUMED' WHERE id='consumed'",
      )
      .run();
    f.db
      .prepare(
        "UPDATE grant_claims SET state='CONSUMED' WHERE attempt='historical'",
      )
      .run();
    f.db
      .prepare(
        "UPDATE attempts SET state='COMPLETED',start=2000,deadline=5402000,original_deadline=5402000,protected=1,checksum=?,access_state='HELD',registered_owner='{}' WHERE id='historical'",
      )
      .run(f.digest);
    f.db
      .prepare(
        "INSERT INTO grant_begin_intents(id,attempt,transport,state,created_at,start,deadline) VALUES('historical-begin','historical','ssh-a','CONSUMED',1000,2000,5402000)",
      )
      .run();
    f.db
      .prepare(
        "INSERT INTO grant_source_retentions VALUES('older',1,?,'historical',?,10001,?,?,1000,'RETAINED',1001)",
      )
      .run(f.digest, f.digest, f.digest, f.digest);
    f.db
      .prepare(
        "UPDATE grant_revisions SET work=? WHERE grant_id IN ('older','newest')",
      )
      .run(
        JSON.stringify({
          kind: "saved",
          attempt: "historical",
          checksum: f.digest,
        }),
      );
    f.db
      .prepare(
        "INSERT INTO grant_source_setup(grant_id,revision,agent,confirm_request,status,lease,lease_until,created,updated) VALUES('older',1,'class','retained-request','RUNNING','original-lease',5000,1000,1001)",
      )
      .run();
    f.db
      .prepare(
        "INSERT INTO grant_source_setup(grant_id,revision,agent,confirm_request,status,created,updated) VALUES('newest',1,'class','newest-retain','QUEUED',1000,1001)",
      )
      .run();
    f.db
      .prepare(
        "INSERT INTO audit VALUES('prior-audit',1000,'instructor','prior','older','preserve')",
      )
      .run();
    const before = f.snapshot();
    f.db.close();
    store = new Store(f.dir);
    const db = store.db;
    for (const [table, rows] of Object.entries(before)) {
      const actual = db
        .prepare(
          `SELECT rowid AS preserved_rowid,* FROM "${table}" ORDER BY rowid`,
        )
        .all();
      if (table === "schema_version")
        expect(actual).toEqual([...rows, { preserved_rowid: 36, version: 36 }]);
      else if (table === "attempt_grants")
        expect(actual).toEqual(
          rows.map((row: any) =>
            row.id === "older" ? { ...row, status: "REVOKED" } : row,
          ),
        );
      else if (table === "audit") expect(actual).toContainEqual(rows[0]);
      else expect(actual, table).toEqual(rows);
    }
    const migrated = db
      .prepare(
        "SELECT * FROM audit WHERE action='migrate-supersede-unused-grant'",
      )
      .all() as any[];
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({
      actor: "system:migration-036",
      target: "older",
    });
    expect(JSON.parse(migrated[0].detail)).toEqual({
      exam: "e",
      username: "alice",
      revision: 1,
      replacement: "newest",
      replacement_revision: 1,
    });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(
      db.prepare("SELECT rowid FROM attempt_grants WHERE id='newest'").get(),
    ).toEqual({ rowid: 99 });
    store.close();
    store = new Store(f.dir);
    expect(
      store.db
        .prepare(
          "SELECT count(*) n FROM audit WHERE action='migrate-supersede-unused-grant'",
        )
        .get(),
    ).toEqual({ n: 1 });
  } finally {
    if (store) store.close();
    else if (f.db.open) f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

it.each([
  "preparing-claim",
  "pending-begin",
  "consumed-begin",
  "begin-start",
  "begin-deadline",
  "attempt-state",
  "attempt-start",
  "attempt-deadline",
  "attempt-original-deadline",
  "attempt-protected",
  "attempt-checksum",
  "attempt-owner",
  "missing-revision",
] as const)(
  "036 refuses %s in any duplicate member and rolls back every group",
  (fault) => {
    const f = fixture();
    try {
      f.grant("safe-old", 1, "AVAILABLE", "bob");
      f.grant("safe-new", 2, "AVAILABLE", "bob");
      f.grant("older", 42);
      f.grant("newest", 99, "PENDING_NATIVE");
      // Ambiguity in the newest row must block normalization too.
      const id = fault === "preparing-claim" ? "newest" : "older";
      if (fault === "missing-revision")
        f.db.prepare("DELETE FROM grant_revisions WHERE grant_id=?").run(id);
      else if (fault.startsWith("attempt-")) {
        f.claim("contradictory", id, "PREPARING");
        // The trigger requires the original available claim before insertion.
        f.db
          .prepare(
            "INSERT INTO attempts(id,exam,username,uid,state,settings,grant_id,grant_revision,grant_hash,grant_kind,grant_issued_order) VALUES('contradictory','e','alice',10001,'PREPARING',?,? ,1,?,'ADDITIONAL',42)",
          )
          .run(JSON.stringify(f.settings), id, f.digest);
        f.db
          .prepare(
            "UPDATE grant_claims SET state='CANCELLED' WHERE attempt='contradictory'",
          )
          .run();
        f.db
          .prepare(
            "UPDATE attempts SET state='CANCELLED_BEFORE_START' WHERE id='contradictory'",
          )
          .run();
        const changes: Record<string, string> = {
          "attempt-state": "state='ACTIVE'",
          "attempt-start": "start=2000",
          "attempt-deadline": "deadline=5402000",
          "attempt-original-deadline": "original_deadline=5402000",
          "attempt-protected": "protected=1",
          "attempt-checksum": "checksum='retained-checksum'",
          "attempt-owner": "registered_owner='{}'",
        };
        f.db
          .prepare(
            `UPDATE attempts SET ${changes[fault]} WHERE id='contradictory'`,
          )
          .run();
      } else {
        f.claim(
          "ambiguous",
          id,
          fault === "preparing-claim" ? "PREPARING" : "CANCELLED",
        );
        if (fault !== "preparing-claim")
          f.db
            .prepare(
              "INSERT INTO grant_begin_intents(id,attempt,transport,state,created_at,start,deadline) VALUES('uncertain-begin','ambiguous','ssh-a',?,1000,?,?)",
            )
            .run(
              fault === "pending-begin"
                ? "PENDING"
                : fault === "consumed-begin"
                  ? "CONSUMED"
                  : "CANCELLED",
              fault === "begin-start" ? 2000 : null,
              fault === "begin-deadline" ? 5402000 : null,
            );
      }
      const before = f.snapshot();
      const migrate = f.db.transaction(() =>
        f.db.exec(readFileSync("migrations/036.sql", "utf8")),
      );
      expect(migrate).toThrow(
        "Duplicate unused attempts have setup or uncertain history",
      );
      expect(f.snapshot()).toEqual(before);
      expect(
        f.db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name='single_unused_grant'",
          )
          .get(),
      ).toBeUndefined();
      expect(f.db.prepare("SELECT name FROM sqlite_temp_schema").all()).toEqual(
        [],
      );
    } finally {
      f.db.close();
      rmSync(f.dir, { recursive: true, force: true });
    }
  },
);

it("036 enforces one unused grant on inserts and updates while preserving new issuance and consumed history", () => {
  const f = fixture();
  let store: Store | undefined;
  try {
    f.grant("only", 42);
    f.grant("historical", 7, "CONSUMED");
    f.grant("cancelled", 10, "REVOKED");
    f.db.close();
    store = new Store(f.dir);
    const db = store.db;
    for (const status of ["AVAILABLE", "PENDING_NATIVE"])
      expect(() =>
        db
          .prepare(
            "INSERT INTO attempt_grants(id,agent,exam,username,revision,status,issued_at,actor,reason,issuance) VALUES(?,'class','e','alice',1,?,2000,'instructor','New permission','ADDITIONAL_TEMPLATE')",
          )
          .run(`blocked-${status}`, status),
      ).toThrow("UNIQUE constraint failed");
    expect(() =>
      db
        .prepare(
          "UPDATE attempt_grants SET status='AVAILABLE' WHERE id='cancelled'",
        )
        .run(),
    ).toThrow("UNIQUE constraint failed");
    db.transaction(() => {
      db.prepare(
        "UPDATE attempt_grants SET status='REVOKED' WHERE id='only'",
      ).run();
      db.prepare(
        "INSERT INTO attempt_grants(id,agent,exam,username,revision,status,issued_at,actor,reason,issuance) VALUES('replacement','class','e','alice',1,'AVAILABLE',2000,'instructor','Replacement permission','ADDITIONAL_TEMPLATE')",
      ).run();
      db.prepare(
        "INSERT INTO grant_revisions SELECT 'replacement',revision,settings,work,hash,actor,reason,at FROM grant_revisions WHERE grant_id='only'",
      ).run();
    })();
    expect(
      db.prepare("SELECT id,status FROM attempt_grants ORDER BY rowid").all(),
    ).toEqual([
      { id: "historical", status: "CONSUMED" },
      { id: "cancelled", status: "REVOKED" },
      { id: "only", status: "REVOKED" },
      { id: "replacement", status: "AVAILABLE" },
    ]);
    expect(
      db
        .prepare(
          "SELECT count(*) n FROM audit WHERE action='migrate-supersede-unused-grant'",
        )
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    if (store) store.close();
    else if (f.db.open) f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
