import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createApp } from "../../apps/server/src/app.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";

async function fixture() {
  const data = mkdtempSync(`${tmpdir()}/exam-retirement-`),
    origin = "http://localhost:3000";
  const config: Parameters<typeof createApp>[0] = {
    mode: "development",
    origin,
    data,
    port: 0,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
    agent: { id: "class", signingKey: "/unused", callbackPublicKey: "/unused" },
  };
  let current = await createApp(config);
  new TemplateCatalog(current.store, "class").sync(
    {
      version: {
        schema: 1,
        name: "v1",
        hash: "a".repeat(64),
        entries: 4,
        files: 2,
        bytes: 30,
        max_file_bytes: 20,
        created: 1000,
      },
      reason: "Synthetic authenticated source for retirement tests",
    },
    {
      agent: "class",
      actor: "agent:class:root",
      request: randomUUID(),
      issued: 1000,
      observed: 1001,
    },
  );
  const session = current.store.session("admin", "instructor", null),
    headers = {
      origin,
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrf,
    };
  const post = (url: string, payload: Record<string, unknown>) =>
    current.app.inject({ method: "POST", url, headers, payload });
  const create = async (id: string) => {
    const result = await post("/api/admin/exams", {
      id,
      name: `Synthetic ${id}`,
      template: "v1",
      template_version: "a".repeat(64),
      duration: 600,
      webcam: false,
      terminals: 4,
      earliest: Date.now() - 1000,
      latest: Date.now() + 3600000,
      requestID: randomUUID(),
    });
    expect(result.statusCode, result.body).toBe(200);
    return result.json();
  };
  const preview = (id: string, action: string) =>
    post(`/api/admin/exams/${id}/retirement-preview`, { action });
  const confirm = (id: string, review: any, requestID = randomUUID()) =>
    post(`/api/admin/exams/${id}/retire`, {
      action: review.action,
      revision: review.revision,
      review: review.review,
      reason: "Reviewed synthetic definition retirement",
      requestID,
    });
  const close = async () => {
    await current.app.close();
    rmSync(data, { recursive: true, force: true });
  };
  return {
    get app() {
      return current.app;
    },
    get store() {
      return current.store;
    },
    get: (url: string) => current.app.inject({ method: "GET", url, headers }),
    async restart() {
      await current.app.close();
      current = await createApp(config);
    },
    post,
    create,
    preview,
    confirm,
    close,
  };
}

function history(
  f: Awaited<ReturnType<typeof fixture>>,
  exam: string,
  settings: any,
  state = "COMPLETED",
) {
  const id = randomUUID(),
    start = Date.now() - 700000,
    deadline = start + 600000;
  f.store.db
    .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
    .run(exam, "synthetic", 0, 600, null, 10001);
  f.store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,access_state,checksum) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      exam,
      "synthetic",
      10001,
      state,
      JSON.stringify(settings),
      start,
      deadline,
      deadline,
      state === "COMPLETED" ? 1 : 0,
      state === "COMPLETED" ? "RELEASED" : "HELD",
      "b".repeat(64),
    );
  return id;
}

it("authenticated reviewed unused-definition deletion preserves audit and original retry across actual restart and ID recreation", async () => {
  const f = await fixture();
  try {
    await f.create("unused");
    const before = f.store.db
      .prepare("SELECT * FROM audit ORDER BY rowid")
      .all();
    const preview = await f.preview("unused", "delete");
    expect(preview.statusCode, preview.body).toBe(200);
    const review = preview.json();
    expect(review).toMatchObject({
      id: "unused",
      action: "delete",
      allowed: true,
    });
    expect(
      f.store.db.prepare("SELECT id FROM exams WHERE id='unused'").get(),
    ).toBeTruthy();
    expect(
      f.store.db.prepare("SELECT * FROM audit ORDER BY rowid").all(),
    ).toEqual(before);
    const request = randomUUID(),
      deleted = await f.confirm("unused", review, request);
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toMatchObject({
      id: "unused",
      action: "delete",
      lifecycle: "deleted",
    });
    expect(
      f.store.db.prepare("SELECT id FROM exams WHERE id='unused'").get(),
    ).toBeUndefined();
    await f.restart();
    const recreated = await f.create("unused");
    expect((await f.confirm("unused", review, request)).json()).toEqual(
      deleted.json(),
    );
    expect(recreated.revision).not.toBe(review.revision);
    expect(
      f.store.db.prepare("SELECT id FROM exams WHERE id='unused'").get(),
    ).toBeTruthy();
    expect((await f.confirm("unused", review)).statusCode).toBe(409);
    expect(
      f.store.db
        .prepare("SELECT * FROM audit WHERE action='delete-exam'")
        .all(),
    ).toHaveLength(1);
  } finally {
    await f.close();
  }
});

it("history requires reviewed archive/unarchive and retains historical settings, intervals, protection and enrollment", async () => {
  const f = await fixture();
  try {
    const definition = await f.create("history"),
      id = randomUUID(),
      start = Date.now() - 700000,
      deadline = start + 600000;
    f.store.db
      .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
      .run("history", "synthetic", 0, 600, null, 10001);
    f.store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,access_state,checksum) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        "history",
        "synthetic",
        10001,
        "COMPLETED",
        JSON.stringify(definition),
        start,
        deadline,
        deadline,
        1,
        "RELEASED",
        "b".repeat(64),
      );
    const original = f.store.attempt(id),
      enrollment = f.store.db
        .prepare("SELECT * FROM enrollments WHERE exam='history'")
        .get();
    const deletion = await f.preview("history", "delete");
    expect(deletion.statusCode, deletion.body).toBe(200);
    expect(deletion.json().allowed).toBe(false);
    expect((await f.confirm("history", deletion.json())).statusCode).toBe(409);
    const archival = await f.preview("history", "archive");
    expect(archival.statusCode, archival.body).toBe(200);
    expect(archival.json()).toMatchObject({ action: "archive", allowed: true });
    const archived = await f.confirm("history", archival.json());
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().lifecycle).toBe("archived");
    expect(f.store.attempt(id)).toEqual(original);
    expect(
      f.store.db
        .prepare("SELECT * FROM enrollments WHERE exam='history'")
        .get(),
    ).toEqual(enrollment);
    const restore = await f.preview("history", "unarchive");
    expect(restore.statusCode, restore.body).toBe(200);
    expect((await f.confirm("history", restore.json())).json().lifecycle).toBe(
      "active",
    );
    expect(f.store.attempt(id)).toEqual(original);
  } finally {
    await f.close();
  }
});

it("retirement refuses stale dependency/configuration reviews and rolls back a failed audit without spending the request", async () => {
  const f = await fixture();
  try {
    const definition = await f.create("fenced"),
      review = (await f.preview("fenced", "delete")).json();
    const updated = await f.post("/api/admin/exams", {
      id: "fenced",
      revision: definition.revision,
      name: "Changed synthetic definition",
      requestID: randomUUID(),
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect((await f.confirm("fenced", review)).statusCode).toBe(409);
    const reverted = await f.post("/api/admin/exams", {
      ...definition,
      revision: updated.json().revision,
      requestID: randomUUID(),
    });
    expect(reverted.statusCode, reverted.body).toBe(200);
    expect(reverted.json().revision).not.toBe(definition.revision);
    expect((await f.confirm("fenced", review)).statusCode).toBe(409);
    const fresh = (await f.preview("fenced", "delete")).json(),
      request = randomUUID();
    f.store.db.exec(
      "CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON audit WHEN NEW.action='delete-exam' BEGIN SELECT RAISE(ABORT,'synthetic audit unavailable'); END;",
    );
    const failedAudit = await f.confirm("fenced", fresh, request);
    expect(failedAudit.statusCode, failedAudit.body).toBe(400);
    expect(failedAudit.json().error).toContain("synthetic audit unavailable");
    expect(
      f.store.db.prepare("SELECT id FROM exams WHERE id='fenced'").get(),
    ).toBeTruthy();
    expect(
      f.store.db
        .prepare("SELECT * FROM exam_definition_requests WHERE request=?")
        .get(request),
    ).toBeUndefined();
    f.store.db.exec("DROP TRIGGER synthetic_audit_failure");
    expect((await f.confirm("fenced", fresh, request)).statusCode).toBe(200);
    const settings = await f.create("dependencies"),
      empty = (await f.preview("dependencies", "delete")).json();
    const id = history(f, "dependencies", settings),
      original = f.store.attempt(id);
    expect((await f.confirm("dependencies", empty)).statusCode).toBe(409);
    expect(f.store.attempt(id)).toEqual(original);
    expect(() =>
      f.store.db.prepare("DELETE FROM exams WHERE id='dependencies'").run(),
    ).toThrow();
  } finally {
    await f.close();
  }
});

it.each([
  "PREPARING",
  "ACTIVATING",
  "ACTIVE",
  "LOCKED",
  "FINALIZING",
  "COLLECTION_FAILED",
])(
  "archive refuses %s work and preserves its full durable record",
  async (state) => {
    const f = await fixture();
    try {
      const definition = await f.create("working"),
        id = history(f, "working", definition, state),
        original = f.store.attempt(id);
      const review = await f.preview("working", "archive");
      expect(review.statusCode, review.body).toBe(200);
      expect(review.json()).toMatchObject({
        allowed: false,
        counts: { attempts: 1 },
      });
      expect(review.json().blockers.join(" ")).toContain("Unfinished");
      expect((await f.confirm("working", review.json())).statusCode).toBe(409);
      expect(f.store.attempt(id)).toEqual(original);
      expect(
        (await f.get("/api/admin/exams"))
          .json()
          .some((e: any) => e.id === "working"),
      ).toBe(true);
    } finally {
      await f.close();
    }
  },
);

it("archive refuses unused saved grants and unknown legacy enrollment without consuming authority", async () => {
  const f = await fixture();
  try {
    await f.create("waiting");
    const add = await f.post("/api/admin/exams/waiting/roster/add", {
      username: "synthetic",
    });
    expect(add.statusCode, add.body).toBe(200);
    const before = f.store.db
      .prepare("SELECT * FROM attempt_grants WHERE exam='waiting'")
      .all();
    expect(before).toMatchObject([{ status: "AVAILABLE" }]);
    const review = (await f.preview("waiting", "archive")).json();
    expect(review.allowed).toBe(false);
    expect(review.blockers.join(" ")).toContain("Unused grants remain");
    expect((await f.confirm("waiting", review)).statusCode).toBe(409);
    expect(
      f.store.db
        .prepare("SELECT * FROM attempt_grants WHERE exam='waiting'")
        .all(),
    ).toEqual(before);
    expect(f.store.db.prepare("SELECT * FROM grant_claims").all()).toEqual([]);
    f.store.db
      .prepare("DELETE FROM grant_revisions WHERE grant_id=?")
      .run((before[0] as any).id);
    const corrupt = await f.preview("waiting", "archive");
    expect(corrupt.statusCode, corrupt.body).toBe(409);
    expect(corrupt.json().error).toContain("Grant history is inconsistent");
    expect(
      f.store.db
        .prepare("SELECT * FROM attempt_grants WHERE exam='waiting'")
        .all(),
    ).toEqual(before);
    await f.create("legacy");
    f.store.db
      .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
      .run("legacy", "synthetic", 0, 600, null, 10001);
    const legacy = (await f.preview("legacy", "archive")).json();
    expect(legacy.allowed).toBe(false);
    expect(legacy.blockers.join(" ")).toContain("Legacy unused enrollment");
    expect((await f.confirm("legacy", legacy)).statusCode).toBe(409);
  } finally {
    await f.close();
  }
});

it("archive refuses uncertain native saved-work references and consumption without a closed attempt", async () => {
  const f = await fixture();
  try {
    await f.create("uncertain");
    const added = await f.post("/api/admin/exams/uncertain/roster/add", {
      username: "synthetic",
    });
    expect(added.statusCode, added.body).toBe(200);
    f.store.db
      .prepare(
        "UPDATE attempt_grants SET status='CONSUMED' WHERE exam='uncertain'",
      )
      .run();
    const consumed = await f.preview("uncertain", "archive");
    expect(consumed.statusCode, consumed.body).toBe(200);
    expect(consumed.json().allowed).toBe(false);
    expect(consumed.json().blockers.join(" ")).toContain("Consumed grant");
    expect((await f.confirm("uncertain", consumed.json())).statusCode).toBe(
      409,
    );
    const settings = await f.create("native-reference");
    history(f, "native-reference", settings);
    f.store.db
      .prepare("INSERT INTO recovery_grant_sources VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        "class",
        "native-reference",
        "synthetic",
        10001,
        randomUUID(),
        "b".repeat(64),
        Date.now(),
        "signed fixture reference",
        Date.now(),
      );
    const native = await f.preview("native-reference", "archive");
    expect(native.statusCode, native.body).toBe(200);
    expect(native.json().allowed).toBe(false);
    expect(native.json().blockers.join(" ")).toContain("Native saved-work");
    expect(
      (await f.confirm("native-reference", native.json())).statusCode,
    ).toBe(409);
  } finally {
    await f.close();
  }
});

it("archive of positively completed grant history preserves consumed authority, claims and original intervals", async () => {
  const f = await fixture();
  try {
    const definition = await f.create("consumed-history");
    expect(
      (
        await f.post("/api/admin/exams", {
          id: definition.id,
          revision: definition.revision,
          earliest: Date.now() - 3600000,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await f.post("/api/admin/exams/consumed-history/roster/add", {
          username: "synthetic",
        })
      ).statusCode,
    ).toBe(200);
    const g = f.store.db
      .prepare(
        "SELECT g.*,g.rowid issued_order,r.settings,r.hash FROM attempt_grants g JOIN grant_revisions r ON r.grant_id=g.id AND r.revision=g.revision WHERE g.exam='consumed-history'",
      )
      .get() as any;
    const id = randomUUID(),
      start = Date.now() - 700000,
      deadline = start + 600000;
    f.store.db
      .prepare("INSERT INTO grant_claims VALUES(?,?,?,?,?,? ,?,NULL)")
      .run(id, g.id, g.revision, g.hash, 10001, "PREPARING", start - 1000);
    f.store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,access_state,checksum,grant_id,grant_revision,grant_hash,grant_issued_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        definition.id,
        "synthetic",
        10001,
        "COMPLETED",
        g.settings,
        start,
        deadline,
        deadline,
        1,
        "RELEASED",
        "b".repeat(64),
        g.id,
        g.revision,
        g.hash,
        g.issued_order,
      );
    f.store.db
      .prepare("UPDATE attempt_grants SET status='CONSUMED' WHERE id=?")
      .run(g.id);
    f.store.db
      .prepare("UPDATE grant_claims SET state='CONSUMED' WHERE attempt=?")
      .run(id);
    const original = f.store.attempt(id),
      grants = f.store.db.prepare("SELECT * FROM attempt_grants").all(),
      claims = f.store.db.prepare("SELECT * FROM grant_claims").all();
    const review = await f.preview(definition.id, "archive");
    expect(review.statusCode, review.body).toBe(200);
    expect(review.json()).toMatchObject({
      allowed: true,
      counts: { attempts: 1, grants: 1, claims: 1 },
    });
    expect((await f.confirm(definition.id, review.json())).statusCode).toBe(
      200,
    );
    expect(f.store.attempt(id)).toEqual(original);
    expect(f.store.db.prepare("SELECT * FROM attempt_grants").all()).toEqual(
      grants,
    );
    expect(f.store.db.prepare("SELECT * FROM grant_claims").all()).toEqual(
      claims,
    );
  } finally {
    await f.close();
  }
});

it("archived history stays inspectable while new settings, enrollment and import refuse until explicit restoration", async () => {
  const f = await fixture();
  try {
    const settings = await f.create("retired"),
      id = history(f, "retired", settings),
      original = f.store.attempt(id);
    const reviewed = (await f.preview("retired", "archive")).json();
    const archived = await f.confirm("retired", reviewed);
    expect(archived.statusCode, archived.body).toBe(200);
    expect(
      (await f.get("/api/admin/exams"))
        .json()
        .some((e: any) => e.id === "retired"),
    ).toBe(false);
    expect(
      (await f.get("/api/admin/exams?lifecycle=archived")).json(),
    ).toMatchObject([{ id: "retired", lifecycle: "archived" }]);
    const dashboard = await f.get("/api/admin/exams/retired/dashboard");
    expect(dashboard.statusCode, dashboard.body).toBe(200);
    expect(dashboard.json().students[0].attempts[0].id).toBe(id);
    for (const [url, payload] of [
      [
        "/api/admin/exams",
        { id: "retired", revision: archived.json().revision, duration: 1200 },
      ],
      ["/api/admin/exams/retired/roster/add", { username: "another" }],
      [
        "/api/admin/exams/retired/roster/import-preview",
        { text: "another", mode: "lines" },
      ],
    ] as const) {
      const result = await f.post(url, payload);
      expect(result.statusCode, result.body).toBe(409);
      expect(result.json().error).toContain("unarchive");
    }
    expect(() =>
      f.store.db
        .prepare("UPDATE exams SET config=? WHERE id='retired'")
        .run(JSON.stringify({ ...settings, duration: 1200 })),
    ).toThrow("Archived definition");
    expect(() =>
      f.store.db
        .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
        .run("retired", "another", 0, 600, null, 10002),
    ).toThrow("Archived definition");
    await f.restart();
    expect(
      (await f.get("/api/admin/exams?lifecycle=archived")).json()[0].id,
    ).toBe("retired");
    expect(
      (
        await f.confirm(
          "retired",
          (await f.preview("retired", "unarchive")).json(),
        )
      ).statusCode,
    ).toBe(200);
    expect(f.store.attempt(id)).toEqual(original);
    expect(
      (await f.get("/api/admin/exams"))
        .json()
        .some((e: any) => e.id === "retired"),
    ).toBe(true);
  } finally {
    await f.close();
  }
});

it("retirement requires administrator authentication, CSRF, exact target and reason; reserved sandbox cannot retire", async () => {
  const f = await fixture();
  try {
    await f.create("private");
    const url = "/api/admin/exams/private/retirement-preview";
    expect(
      (
        await f.app.inject({
          method: "POST",
          url,
          payload: { action: "delete" },
        })
      ).statusCode,
    ).toBe(403);
    const s = f.store.session("student", "synthetic", null);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url,
          headers: {
            origin: "http://localhost:3000",
            cookie: `session=${s.token}`,
            "x-csrf-token": s.csrf,
          },
          payload: { action: "delete" },
        })
      ).statusCode,
    ).toBe(401);
    const review = (await f.preview("private", "delete")).json();
    expect(
      (
        await f.post("/api/admin/exams/private/retire", {
          action: review.action,
          revision: review.revision,
          review: review.review,
          requestID: randomUUID(),
          reason: "short",
        })
      ).statusCode,
    ).toBe(400);
    for (const action of ["delete", "archive"]) {
      const reserved = (await f.preview("sandbox", action)).json();
      expect(reserved.allowed).toBe(false);
      expect((await f.confirm("sandbox", reserved)).statusCode).toBe(409);
    }
    expect(
      f.store.db.prepare("SELECT id FROM exams WHERE id='private'").get(),
    ).toBeTruthy();
  } finally {
    await f.close();
  }
});

it("actual migration marks pre-existing definitions uncertain instead of treating missing web rows as native absence", async () => {
  const f = await fixture();
  try {
    const old = await f.create("old-native-unknown");
    // Reconstruct this synthetic database's pre028 lifecycle/reconciliation
    // schema, then let actual Store startup apply028 and033. Other unrelated
    // migrations stay intact; the container smoke separately upgrades24->33.
    f.store.db.exec(
      "DROP TRIGGER exam_lifecycle_created; DROP TRIGGER exam_lifecycle_deleted; DROP TRIGGER exam_lifecycle_settings_changed; DROP TRIGGER archived_definition_settings; DROP TRIGGER archived_definition_enrollment; DROP TRIGGER archived_definition_grant; DROP TRIGGER archived_definition_attempt; DROP TRIGGER archived_definition_grant_reactivation; DROP TRIGGER unused_definition_only; DROP TABLE exam_lifecycle; DROP TABLE exam_native_reconciliations; DELETE FROM schema_version WHERE version IN (28,33);",
    );
    await f.restart();
    for (const action of ["delete", "archive"]) {
      const review = await f.preview(old.id, action);
      expect(review.statusCode, review.body).toBe(200);
      expect(review.json()).toMatchObject({
        allowed: false,
        counts: { attempts: 0, grants: 0 },
        native: { status: "required", evidence: null, has_history: false },
      });
      expect(review.json().blockers.join(" ")).toContain(
        "web exams native-review",
      );
      expect((await f.confirm(old.id, review.json())).statusCode).toBe(409);
    }
    expect(() =>
      f.store.db.prepare("DELETE FROM exams WHERE id=?").run(old.id),
    ).toThrow();
    const fresh = await f.create("tracked-after-migration"),
      review = await f.preview(fresh.id, "delete");
    expect(review.json().allowed).toBe(true);
    expect((await f.confirm(fresh.id, review.json())).statusCode).toBe(200);
    expect(
      f.store.db.prepare("SELECT id FROM exams WHERE id=?").get(old.id),
    ).toBeTruthy();
  } finally {
    await f.close();
  }
});
