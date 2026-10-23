import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { Store } from "../../apps/server/src/db.js";
import { RosterManagement } from "../../apps/server/src/roster-management.js";
import { RecoverySources } from "../../apps/server/src/recovery-source.js";

it("web settings and CSV persist only explicit allowance authorization, atomically, without editing attempts", async () => {
  const dir = mkdtempSync(tmpdir() + "/recovery-setting-");
  const { app, store } = await createApp({
    mode: "development",
    origin: "http://localhost:3000",
    port: 3000,
    data: dir,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  });
  try {
    const definition = { duration: 3600, webcam: true };
    store.db
      .prepare("INSERT INTO exams VALUES('recovery',?)")
      .run(JSON.stringify(definition));
    const roster = new RosterManagement(store);
    // Legacy enrollment predates unified issuance; exercise its C17 edit path.
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid) VALUES('recovery','student',0)",
      )
      .run();
    expect(roster.allowanceEdit("recovery", "student")).toBeNull();
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline) VALUES('historical','recovery','student',10001,'COMPLETED',?,100,3600100,3600100)",
      )
      .run(JSON.stringify(definition));
    const original = store.attempt("historical");
    const session = store.session("admin", "instructor", null);
    const headers = {
      cookie: `session=${session.token}`,
      origin: "http://localhost:3000",
      "x-csrf-token": session.csrf,
    };
    const post = (path: string, payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/api/admin/exams/recovery/roster/${path}`,
        headers,
        payload,
      });
    expect(
      (await post("settings", { usernames: ["student"], duration: 4500 }))
        .statusCode,
    ).toBe(200);
    const explicit = roster.allowanceEdit("recovery", "student")!;
    expect(explicit).toMatchObject({ duration: 4500, actor: "instructor" });
    store.db
      .prepare("UPDATE exams SET config=? WHERE id='recovery'")
      .run(JSON.stringify({ ...definition, duration: 5400 }));
    expect(roster.allowanceEdit("recovery", "student")).toEqual(explicit);
    expect(
      (await post("settings", { usernames: ["student"], webcam: false }))
        .statusCode,
    ).toBe(200);
    expect(roster.allowanceEdit("recovery", "student")).toEqual(explicit);
    expect(
      (
        await post("settings", {
          usernames: ["student", "not_enrolled"],
          duration: 6000,
        })
      ).statusCode,
    ).toBe(400);
    expect(roster.allowanceEdit("recovery", "student")).toEqual(explicit);
    expect(roster.list("recovery")[0].duration).toBe(4500);
    expect(
      (await post("settings", { usernames: ["student"], duration: null }))
        .statusCode,
    ).toBe(200);
    const inherited = roster.allowanceEdit("recovery", "student")!;
    expect(inherited.duration).toBe(5400);
    expect(inherited.revision).toBeGreaterThan(explicit.revision);
    store.db
      .prepare("UPDATE exams SET config=? WHERE id='recovery'")
      .run(JSON.stringify({ ...definition, duration: 7200 }));
    expect(roster.allowanceEdit("recovery", "student")).toEqual(inherited);
    const importRows = async (text: string) => {
      const preview = await post("import-preview", { text });
      expect(preview.statusCode).toBe(200);
      const payload = { id: preview.json().id };
      expect((await post("import-confirm", payload)).statusCode).toBe(200);
      return payload;
    };
    await importRows("username,require_webcam\nstudent,true");
    expect(roster.allowanceEdit("recovery", "student")).toEqual(inherited);
    const imported = await importRows("username,duration_minutes\nstudent,75");
    const csvEdit = roster.allowanceEdit("recovery", "student")!;
    expect(csvEdit.duration).toBe(4500);
    expect(csvEdit.revision).toBeGreaterThan(inherited.revision);
    expect((await post("import-confirm", imported)).statusCode).toBe(200);
    expect(roster.allowanceEdit("recovery", "student")).toEqual(csvEdit);
    // An explicit repeated value is still authorization, unlike an omitted column.
    await importRows("username,duration_minutes\nstudent,75");
    expect(
      roster.allowanceEdit("recovery", "student")!.revision,
    ).toBeGreaterThan(csvEdit.revision);
    expect(store.attempt("historical")).toEqual(original);
    roster.remove(
      "recovery",
      { username: "student", confirm: true },
      "instructor",
    );
    expect(roster.allowanceEdit("recovery", "student")).not.toBeNull();
    expect(store.attempt("historical")).toEqual(original);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("authenticated source expectations and revision counters survive restart and never authorize a different saved source", () => {
  const dir = mkdtempSync(tmpdir() + "/recovery-source-");
  let store = new Store(dir);
  try {
    store.db
      .prepare("INSERT INTO exams VALUES('recovery',?)")
      .run(JSON.stringify({ duration: 3600 }));
    const roster = new RosterManagement(store);
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid) VALUES('recovery','student',0)",
      )
      .run();
    roster.settings(
      "recovery",
      { usernames: ["student"], duration: 4500 },
      "instructor",
    );
    const edit = roster.allowanceEdit("recovery", "student")!;
    const receipt = {
      version: 1 as const,
      exam: "recovery",
      username: "student",
      uid: 10001,
      duration: 4500,
      source_attempt: "11111111-1234-4234-8234-123456789abc",
      checksum: "a".repeat(64),
      grant_hash: "b".repeat(64),
      created_at: Date.now() - 1000,
      allowance_revision: edit,
    };
    new RecoverySources(store, "class").remember(receipt);
    store.db.close();
    store = new Store(dir);
    const sources = new RecoverySources(store, "class");
    expect(sources.known("recovery", "student")).toEqual(receipt);
    expect(
      new RecoverySources(store, "other-agent").known("recovery", "student"),
    ).toBeNull();
    for (const change of [
      { uid: 10002 },
      { checksum: "c".repeat(64) },
      { source_attempt: "22222222-1234-4234-8234-123456789abc" },
      { created_at: receipt.created_at + 1 },
    ]) {
      expect(() => sources.remember({ ...receipt, ...change })).toThrow(
        "source differs",
      );
      expect(sources.known("recovery", "student")).toEqual(receipt);
    }
    const restartedRoster = new RosterManagement(store);
    restartedRoster.settings(
      "recovery",
      { usernames: ["student"], duration: 5400 },
      "instructor",
    );
    expect(
      restartedRoster.allowanceEdit("recovery", "student")!.revision,
    ).toBeGreaterThan(edit.revision);
    expect(
      store.db.prepare("SELECT count(*) AS n FROM attempts").get(),
    ).toEqual({ n: 0 });
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
