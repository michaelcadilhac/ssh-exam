import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { grantExam } from "../fixtures/grant-exam.js";

async function fixture() {
  const data = mkdtempSync(tmpdir() + "/historical-student-grants-"),
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
    }),
    settings = grantExam(store, "permanent-history"),
    definitions = new ExamDefinitions(store, "class"),
    session = store.session("admin", "instructor", null),
    headers = {
      origin,
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrf,
    },
    post = (url: string, payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url, headers, payload }),
    rawEnrollment = (username: string) =>
      store.db
        .prepare("SELECT * FROM enrollments WHERE exam=? AND username=?")
        .get(settings.id, username),
    history = (username: string, duration = 7200, webcam = false) => {
      const id = randomUUID(),
        start = Date.now() - 10800000;
      store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state) VALUES(?,?,?,10001,'COMPLETED',?,?,?,?,1,?,'RELEASED')",
        )
        .run(
          id,
          settings.id,
          username,
          JSON.stringify({ ...settings, duration, webcam }),
          start,
          start + duration * 1000,
          start + duration * 1000,
          "b".repeat(64),
        );
      return store.attempt(id);
    },
    preview = (usernames: string[], extra: Record<string, unknown> = {}) =>
      post(`/api/admin/exams/${settings.id}/grants/additional-preview`, {
        definition_revision: definitions.show(settings.id).revision,
        template_version: settings.template_version,
        earliest: Date.now() - 1000,
        latest: Date.now() + 600000,
        usernames,
        preserve_duration: true,
        reason: "Explicit new attempts for permanent exam students",
        request: randomUUID(),
        ...extra,
      }),
    confirm = (review: any, request = randomUUID()) =>
      post(`/api/admin/grant-issuance/${review.id}/confirm`, {
        revision: review.revision,
        replacement_policy: "single-unused-v1",
        request,
      });
  return {
    app,
    store,
    settings,
    headers,
    post,
    history,
    preview,
    confirm,
    rawEnrollment,
    async close() {
      await app.close();
      rmSync(data, { recursive: true, force: true });
    },
  };
}

it("only explicit confirmation admits a historical student, preserving saved files and their full unused allowance", async () => {
  const f = await fixture();
  try {
    const before = f.history("history01"),
      student = f.store.session("student", "history01", f.settings.id),
      studentHeaders = { cookie: `session=${student.token}` },
      inaccessible = () =>
        f.app.inject({ url: "/api/student/exam", headers: studentHeaders });
    expect((await inaccessible()).statusCode).toBe(400);
    const listed = await f.app.inject({
      url: `/api/admin/exams/${f.settings.id}/roster`,
      headers: f.headers,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().map((r: any) => r.username)).toContain("history01");
    expect(f.rawEnrollment("history01")).toBeUndefined();
    const preview = await f.preview(["history01"], {
      work: { kind: "saved", attempt: before.id, checksum: before.checksum },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().rows[0]).toMatchObject({
      settings: { duration: 7200, webcam: false },
      work: { kind: "saved", attempt: before.id, checksum: before.checksum },
    });
    expect(f.rawEnrollment("history01")).toBeUndefined();
    expect((await inaccessible()).statusCode).toBe(400);
    expect(
      f.store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
    ).toEqual({ n: 0 });

    const request = randomUUID(),
      confirmed = await f.confirm(preview.json(), request);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect((await f.confirm(preview.json(), request)).json()).toEqual(
      confirmed.json(),
    );
    expect(f.rawEnrollment("history01")).toMatchObject({
      uid: 0,
      duration: 7200,
      webcam: 0,
    });
    const granted = await f.app.inject({
      url: `/api/admin/grants/${confirmed.json().issued[0].grant}`,
      headers: f.headers,
    });
    expect(granted.statusCode, granted.body).toBe(200);
    expect(granted.json()).toMatchObject({
      status: "PENDING_NATIVE",
      settings: { duration: 7200, webcam: false },
      work: { kind: "saved", attempt: before.id, checksum: before.checksum },
    });
    expect(
      f.store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
    ).toEqual({ n: 0 });
    expect(
      f.store.db.prepare("SELECT count(*) n FROM grant_begin_intents").get(),
    ).toEqual({ n: 0 });
    expect(f.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 1 },
    );
    expect(f.store.attempt(before.id)).toEqual(before);
    expect(
      f.store.db
        .prepare(
          "SELECT count(*) n FROM audit WHERE action='restore-student-admission'",
        )
        .get(),
    ).toEqual({ n: 1 });
  } finally {
    await f.close();
  }
});

it("explicitly replaces a grant-only student's old permission without reviving it or starting a clock", async () => {
  const f = await fixture();
  try {
    const added = await f.post(`/api/admin/exams/${f.settings.id}/roster/add`, {
      username: "grantonly",
      duration: 6000,
      webcam: false,
    });
    expect(added.statusCode, added.body).toBe(200);
    const old = f.store.db
      .prepare(
        "SELECT id,status FROM attempt_grants WHERE username='grantonly'",
      )
      .get() as any;
    // Reproduce legacy metadata: saved permission exists without its old row.
    f.store.db
      .prepare("DELETE FROM enrollments WHERE exam=? AND username='grantonly'")
      .run(f.settings.id);
    const preview = await f.preview(["grantonly"], { work: { kind: "empty" } });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(f.rawEnrollment("grantonly")).toBeUndefined();
    expect(
      f.store.db
        .prepare("SELECT status FROM attempt_grants WHERE id=?")
        .get(old.id),
    ).toEqual({ status: "AVAILABLE" });
    const confirmed = await f.confirm(preview.json());
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().issued[0].replaced.map((r: any) => r.id)).toEqual([
      old.id,
    ]);
    expect(
      f.store.db
        .prepare("SELECT status FROM attempt_grants WHERE id=?")
        .get(old.id),
    ).toEqual({ status: "REVOKED" });
    expect(f.rawEnrollment("grantonly")).toMatchObject({
      uid: 0,
      duration: 6000,
      webcam: 0,
    });
    expect(f.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 0 },
    );
    expect(
      f.store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
    ).toEqual({ n: 0 });
  } finally {
    await f.close();
  }
});

it("revalidates every saved archive before restoring any historical student's admission", async () => {
  const f = await fixture();
  try {
    const originals = [f.history("history01"), f.history("history02")],
      preview = await f.preview(["history01", "history02"], {
        saved_sources: originals.map((a) => ({
          username: a.username,
          attempt: a.id,
          checksum: a.checksum,
        })),
      });
    expect(preview.statusCode, preview.body).toBe(200);
    f.store.db
      .prepare("UPDATE attempts SET checksum=? WHERE id=?")
      .run("c".repeat(64), originals[1].id);
    const refused = await f.confirm(preview.json());
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error).toContain("confirmed protected files");
    for (const username of ["history01", "history02"])
      expect(f.rawEnrollment(username)).toBeUndefined();
    for (const table of [
      "attempt_grants",
      "grant_source_setup",
      "grant_claims",
      "grant_begin_intents",
    ])
      expect(
        f.store.db.prepare(`SELECT count(*) n FROM ${table}`).get(),
      ).toEqual({ n: 0 });
    expect(
      f.store.db
        .prepare(
          "SELECT count(*) n FROM audit WHERE action='restore-student-admission'",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(f.store.attempt(originals[0].id)).toEqual(originals[0]);
    expect(f.store.attempt(originals[1].id)).toEqual({
      ...originals[1],
      checksum: "c".repeat(64),
    });
  } finally {
    await f.close();
  }
});

it("validates a whole historical batch before restoring any admission, then permits a fresh reviewed retry", async () => {
  const f = await fixture();
  try {
    const originals = [
        f.history("history01"),
        f.history("history02", 6600, true),
      ],
      preview = await f.preview(["history01", "history02"], {
        work: { kind: "empty" },
      });
    expect(preview.statusCode, preview.body).toBe(200);
    // A second target changes after review. Even the alphabetically first row
    // must remain absent when the complete confirmation is refused.
    f.store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,duration,webcam,uid) VALUES(?,'history02',6000,1,0)",
      )
      .run(f.settings.id);
    const refused = await f.confirm(preview.json());
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error).toContain("changed after this review");
    expect(f.rawEnrollment("history01")).toBeUndefined();
    expect(f.rawEnrollment("history02")).toMatchObject({
      duration: 6000,
      uid: 0,
    });
    expect(
      f.store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
    ).toEqual({ n: 0 });
    expect(
      f.store.db
        .prepare(
          "SELECT count(*) n FROM audit WHERE action='restore-student-admission'",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(
      f.store.db
        .prepare("SELECT status FROM grant_issuance_previews WHERE id=?")
        .get(preview.json().id),
    ).toEqual({ status: "REVIEW" });
    const fresh = await f.preview(["history01", "history02"], {
      work: { kind: "empty" },
    });
    expect(fresh.statusCode, fresh.body).toBe(200);
    const confirmed = await f.confirm(fresh.json());
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().issued).toHaveLength(2);
    expect(f.rawEnrollment("history01")).toMatchObject({
      uid: 0,
      duration: 7200,
      webcam: 0,
    });
    expect(f.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 2 },
    );
    for (const before of originals)
      expect(f.store.attempt(before.id)).toEqual(before);
  } finally {
    await f.close();
  }
});
