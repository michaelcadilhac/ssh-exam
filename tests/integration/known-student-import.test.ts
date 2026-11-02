import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { grantExam } from "../fixtures/grant-exam.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

async function fixture() {
  const data = mkdtempSync(tmpdir() + "/known-student-import-"),
    origin = "http://localhost:3000",
    { app, store } = await createApp({
      mode: "development",
      origin,
      data,
      port: 0,
      maintenance: false,
      jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
      class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
      agent: {
        id: "class",
        signingKey: "/unused",
        callbackPublicKey: "/unused",
      },
    });
  cleanups.push(async () => {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  });
  // Author metadata only: native archive verification is qualified elsewhere.
  const settings = grantExam(store, "known-student-import"),
    admin = store.session("admin", "known-student-instructor", null),
    headers = {
      origin,
      cookie: `session=${admin.token}`,
      "x-csrf-token": admin.csrf,
    },
    post = (action: string, payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/api/admin/exams/${settings.id}/roster/${action}`,
        headers,
        payload,
      }),
    rawStudent = (username: string) =>
      store.db
        .prepare("SELECT * FROM enrollments WHERE exam=? AND username=?")
        .get(settings.id, username),
    snapshot = () =>
      Object.fromEntries(
        [
          "enrollments",
          "attempts",
          "attempt_grants",
          "grant_revisions",
          "grant_claims",
          "grant_begin_intents",
          "previews",
          "recovery_allowance_edits",
          "audit",
        ].map((table) => [
          table,
          store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ]),
      );
  const knownWithoutAdmission = async (
    username: string,
    kind: "history" | "permission",
  ) => {
    if (kind === "history") {
      const start = Date.now() - 10800000;
      store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state) VALUES(?,?,?,10001,'COMPLETED',?,?,?,?,1,?,'RELEASED')",
        )
        .run(
          randomUUID(),
          settings.id,
          username,
          JSON.stringify(settings),
          start,
          start + settings.duration * 1000,
          start + settings.duration * 1000,
          "b".repeat(64),
        );
    } else {
      const added = await post("add", { username });
      expect(added.statusCode, added.body).toBe(200);
      // Reproduce legacy incomplete membership, not a supported removal path.
      store.db
        .prepare("DELETE FROM enrollments WHERE exam=? AND username=?")
        .run(settings.id, username);
    }
    expect(rawStudent(username)).toBeUndefined();
    const student = store.session("student", username, settings.id);
    return () =>
      app.inject({
        url: "/api/student/exam",
        headers: { cookie: `session=${student.token}` },
      });
  };
  return {
    app,
    store,
    settings,
    post,
    rawStudent,
    snapshot,
    knownWithoutAdmission,
  };
}

for (const kind of ["history", "permission"] as const) {
  it(`refuses Add for a known ${kind} student without restoring old admission`, async () => {
    const t = await fixture(),
      probe = await t.knownWithoutAdmission("knownstudent", kind),
      before = t.snapshot();
    expect((await probe()).statusCode).toBe(400);
    const refused = await t.post("add", {
      username: "knownstudent",
      duration: 7200,
      webcam: false,
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error).toContain("Allow attempt");
    expect(t.rawStudent("knownstudent")).toBeUndefined();
    expect((await probe()).statusCode).toBe(400);
    expect(t.snapshot()).toEqual(before);
  });

  it(`refuses CSV preview containing a known ${kind} student before publishing or granting anything`, async () => {
    const t = await fixture(),
      probe = await t.knownWithoutAdmission("knownstudent", kind),
      before = t.snapshot(),
      refused = await t.post("import-preview", {
        text: "username\nfreshstudent\nknownstudent\n",
        mode: "csv",
      });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error).toContain("knownstudent");
    expect(refused.json().error).toContain("Allow attempt");
    expect(t.rawStudent("freshstudent")).toBeUndefined();
    expect(t.rawStudent("knownstudent")).toBeUndefined();
    expect((await probe()).statusCode).toBe(400);
    expect(t.snapshot()).toEqual(before);
  });

  it(`rechecks CSV membership when a student gains ${kind} after preview, before the first batch write`, async () => {
    const t = await fixture(),
      preview = await t.post("import-preview", {
        text: "username\nfreshstudent\nknownstudent\n",
        mode: "csv",
      });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().summary.added).toBe(2);
    const probe = await t.knownWithoutAdmission("knownstudent", kind),
      before = t.snapshot(),
      refused = await t.post("import-confirm", { id: preview.json().id });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error).toContain("knownstudent");
    expect(refused.json().error).toContain("Allow attempt");
    expect(refused.json().code).toBe("ROSTER_REVIEW_REQUIRED");
    expect(t.rawStudent("freshstudent")).toBeUndefined();
    expect(t.rawStudent("knownstudent")).toBeUndefined();
    expect((await probe()).statusCode).toBe(400);
    expect(t.snapshot()).toEqual(before);
  });
}

it("still imports existing student metadata and unknown students atomically without revising saved permissions", async () => {
  const t = await fixture(),
    added = await t.post("add", {
      username: "existingstudent",
      duration: 3600,
      webcam: false,
      uid: 29999,
    });
  expect(added.statusCode, added.body).toBe(200);
  const before = t.store.db
    .prepare(
      "SELECT g.*,r.settings,r.work,r.hash FROM attempt_grants g JOIN grant_revisions r ON r.grant_id=g.id AND r.revision=g.revision WHERE g.exam=? AND g.username=?",
    )
    .get(t.settings.id, "existingstudent");
  const preview = await t.post("import-preview", {
    text: "username,require_webcam,duration_minutes\nexistingstudent,true,120\nfreshstudent,false,90\n",
    mode: "csv",
  });
  expect(preview.statusCode, preview.body).toBe(200);
  expect(preview.json().summary).toEqual({
    added: 1,
    changed: 1,
    unchanged: 0,
  });
  const confirmed = await t.post("import-confirm", { id: preview.json().id });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  expect(t.rawStudent("existingstudent")).toMatchObject({
    duration: 7200,
    webcam: 1,
    uid: 0,
  });
  expect(t.rawStudent("freshstudent")).toMatchObject({
    duration: 5400,
    webcam: 0,
    uid: 0,
  });
  expect(
    t.store.db
      .prepare(
        "SELECT g.*,r.settings,r.work,r.hash FROM attempt_grants g JOIN grant_revisions r ON r.grant_id=g.id AND r.revision=g.revision WHERE g.exam=? AND g.username=?",
      )
      .get(t.settings.id, "existingstudent"),
  ).toEqual(before);
  expect(
    t.store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
  ).toEqual({ n: 2 });
  expect(t.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual({
    n: 0,
  });
  expect(
    t.store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
  ).toEqual({ n: 0 });
  expect(
    t.store.db.prepare("SELECT count(*) n FROM grant_begin_intents").get(),
  ).toEqual({ n: 0 });
});
