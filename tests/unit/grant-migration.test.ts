import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";

it.each([false, true])(
  "025 preserves populated grant/history authority and rolls back invalid FKs (corrupt=%s)",
  (corrupt) => {
    const dir = mkdtempSync(tmpdir() + "/grant-migration-"),
      file = `${dir}/metadata.sqlite`;
    let db = new Database(file),
      store: Store | undefined;
    try {
      db.pragma("foreign_keys = OFF");
      for (const name of readdirSync("migrations")
        .filter((n) => /^\d{3}\.sql$/.test(n) && Number(n.slice(0, 3)) <= 24)
        .sort())
        db.exec(readFileSync(`migrations/${name}`, "utf8"));
      const grant = "33333333-1234-4234-8234-123456789abc",
        attempt = "44444444-1234-4234-8234-123456789abc",
        digest = "a".repeat(64);
      const settings = JSON.stringify({
        id: "e",
        name: "Migration exam",
        template: "v1",
        template_version: digest,
        duration: 5400,
        webcam: true,
        terminals: 2,
        earliest: 100,
        latest: 200,
      });
      db.prepare("INSERT INTO exams VALUES('e',?)").run(settings);
      db.prepare(
        "INSERT INTO attempt_grants(rowid,id,agent,exam,username,revision,status,issued_at,actor,reason,issuance) VALUES(42,?,'class','e','alice',1,'AVAILABLE',1000,'operator','Original initial grant','ENROLLMENT')",
      ).run(grant);
      db.prepare("INSERT INTO grant_revisions VALUES(?,1,?,?,?,?,?,?)").run(
        grant,
        settings,
        JSON.stringify({ kind: "template", name: "v1", hash: digest }),
        digest,
        "operator",
        "Original saved settings",
        1000,
      );
      db.prepare(
        "INSERT INTO enrollments(exam,username,uid) VALUES('e','alice',10001)",
      ).run();
      db.prepare(
        "INSERT INTO grant_claims VALUES(?, ?,1,?,10001,'PREPARING',1000,NULL)",
      ).run(attempt, grant, digest);
      db.prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,grant_id,grant_revision,grant_hash) VALUES(?,'e','alice',10001,'PREPARING',?,?,1,?)",
      ).run(attempt, settings, grant, digest);
      db.prepare(
        "INSERT INTO grant_begin_intents(id,attempt,transport,state,created_at,verified_at,start,deadline) VALUES('55555555-1234-4234-8234-123456789abc',?,'ssh-a','CONSUMED',1000,1001,2000,5402000)",
      ).run(attempt);
      db.prepare(
        "UPDATE attempts SET state='COMPLETED',start=2000,deadline=5402000,original_deadline=5402000,protected=1,checksum=?,access_state='HELD' WHERE id=?",
      ).run(digest, attempt);
      db.prepare(
        "UPDATE grant_claims SET state='CONSUMED' WHERE attempt=?",
      ).run(attempt);
      db.prepare("UPDATE attempt_grants SET status='CONSUMED' WHERE id=?").run(
        grant,
      );
      db.prepare(
        "INSERT INTO grant_management_requests VALUES('operator','66666666-1234-4234-8234-123456789abc',?,?,1000)",
      ).run("fingerprint", JSON.stringify({ grant }));
      db.prepare(
        "INSERT INTO grant_issuance_previews VALUES('77777777-1234-4234-8234-123456789abc','class','operator',?,?,1000,901000,'CONFIRMED',?)",
      ).run(
        JSON.stringify({
          kind: "NEW_LEGACY_INITIAL_GRANTS",
          agent: "class",
          exam: "e",
          actor: "operator",
          reason: "Original new issuance",
          definition_revision: digest,
          rows: [],
        }),
        digest,
        JSON.stringify([{ username: "alice", grant }]),
      );
      if (corrupt)
        db.prepare(
          "INSERT INTO grant_claims VALUES('orphan','absent',1,?,10002,'CANCELLED',1000,1001)",
        ).run(digest);
      const tables = [
        "attempt_grants",
        "grant_revisions",
        "grant_claims",
        "grant_begin_intents",
        "grant_management_requests",
        "grant_issuance_previews",
        "grant_exam_modes",
        "enrollments",
      ];
      const before = Object.fromEntries(
        tables.map((t) => [
          t,
          db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
        ]),
      );
      const old = db
        .prepare("SELECT * FROM attempts WHERE id=?")
        .get(attempt) as any;
      db.close();
      if (corrupt) {
        expect(() => new Store(dir)).toThrow(
          "Additional-grant migration foreign-key check failed",
        );
        db = new Database(file);
        expect(
          db.prepare("SELECT 1 FROM schema_version WHERE version=25").get(),
        ).toBeUndefined();
        expect(
          (db.pragma("table_info(attempts)") as any[]).map((c) => c.name),
        ).not.toContain("grant_kind");
      } else {
        store = new Store(dir);
        db = store.db;
        expect(db.pragma("foreign_key_check")).toEqual([]);
        expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
        const {
          grant_kind,
          grant_issued_order,
          grant_initial,
          grant_work,
          ...kept
        } = store.attempt(attempt);
        expect(kept).toEqual(old);
        expect(grant_kind).toBeNull();
        expect(grant_issued_order).toBeNull();
        expect(grant_initial).toBeNull();
        expect(grant_work).toBeNull();
        expect(
          db.prepare("SELECT rowid FROM attempt_grants WHERE id=?").get(grant),
        ).toEqual({ rowid: 42 });
        const next = "88888888-1234-4234-8234-123456789abc",
          nextAttempt = "99999999-1234-4234-8234-123456789abc";
        const blocked = db.transaction(() => {
          db.prepare(
            "INSERT INTO attempt_grants(id,agent,exam,username,revision,status,issued_at,actor,reason,issuance) VALUES(?,'class','e','alice',1,'AVAILABLE',3000,'operator','New explicit extra grant','ADDITIONAL_TEMPLATE')",
          ).run(next);
          const order = (
            db
              .prepare("SELECT rowid FROM attempt_grants WHERE id=?")
              .get(next) as any
          ).rowid;
          db.prepare("INSERT INTO grant_revisions VALUES(?,1,?,?,?,?,?,?)").run(
            next,
            settings,
            JSON.stringify({ kind: "template", name: "v1", hash: digest }),
            digest,
            "operator",
            "Explicit extra allowance",
            3000,
          );
          db.prepare(
            "INSERT INTO grant_claims VALUES(?,?,1,?,10001,'PREPARING',3000,NULL)",
          ).run(nextAttempt, next, digest);
          db.prepare(
            "INSERT INTO attempts(id,exam,username,uid,state,settings,grant_id,grant_revision,grant_hash,grant_kind,grant_issued_order) VALUES(?,'e','alice',10001,'PREPARING',?,?,1,?,'ADDITIONAL',?)",
          ).run(nextAttempt, settings, next, digest, order);
        });
        expect(blocked).toThrow(
          "Account remains restricted by an original exam interval",
        );
        expect(
          db.prepare("SELECT 1 FROM attempt_grants WHERE id=?").get(next),
        ).toBeUndefined();
        expect(() =>
          db
            .prepare(
              "INSERT INTO grant_claims VALUES('another',?,1,?,10001,'PREPARING',3000,NULL)",
            )
            .run(grant, digest),
        ).toThrow("UNIQUE constraint failed");
      }
      for (const table of tables) {
        const rows = db
          .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
          .all() as any[];
        const kept =
          table === "attempt_grants" && !corrupt
            ? rows.map(({ initial_grant, ...rest }) => {
                expect(initial_grant).toBeNull();
                return rest;
              })
            : rows;
        expect(kept, table).toEqual(before[table]);
      }
      expect(
        db.prepare("SELECT rowid FROM attempt_grants WHERE id=?").get(grant),
      ).toEqual({ rowid: 42 });
    } finally {
      if (store) store.close();
      else if (db.open) db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
