import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { createApp } from "../../apps/server/src/app.js";
import { RosterManagement } from "../../apps/server/src/roster-management.js";
import { grantExam } from "../fixtures/grant-exam.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

async function fixture() {
  const data = mkdtempSync(tmpdir() + "/exam-student-list-"),
    origin = "http://localhost:3000";
  const { app, store } = await createApp({
    mode: "development",
    origin,
    data,
    port: 0,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
    agent: { id: "class", signingKey: "/unused", callbackPublicKey: "/unused" },
  });
  cleanups.push(async () => {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  });
  const settings = grantExam(store, "one-student-list"),
    names = Array.from(
      { length: 70 },
      (_, i) => `student${String(i).padStart(3, "0")}`,
    );
  for (const username of names.slice(0, 66))
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,webcam,duration,uid) VALUES(?,?,NULL,NULL,0)",
      )
      .run(settings.id, username);
  const start = Date.now() - 10800000;
  for (const username of names.slice(66))
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state) VALUES(?,?,?,10001,'COMPLETED',?,?,?,?,1,?,'RELEASED')",
      )
      .run(
        randomUUID(),
        settings.id,
        username,
        JSON.stringify({ ...settings, duration: 7200, webcam: false }),
        start,
        start + 7200000,
        start + 7200000,
        "b".repeat(64),
      );
  grantExam(store, "another-exam");
  store.db
    .prepare(
      "INSERT INTO enrollments(exam,username,webcam,duration,uid) VALUES('another-exam','other_student',NULL,NULL,0)",
    )
    .run();
  const admin = store.session("admin", "instructor", null),
    headers = {
      origin,
      cookie: `session=${admin.token}`,
      "x-csrf-token": admin.csrf,
    };
  const get = (path: string) =>
    app.inject({ url: `/api/admin/exams/${settings.id}/${path}`, headers });
  const remove = (username: string, exam = settings.id) =>
    app.inject({
      method: "POST",
      url: `/api/admin/exams/${exam}/roster/remove`,
      headers,
      payload: { username, confirm: true },
    });
  const snapshot = () =>
    Object.fromEntries(
      [
        "enrollments",
        "attempts",
        "attempt_grants",
        "grant_revisions",
        "grant_claims",
        "grant_begin_intents",
        "audit",
      ].map((table) => [
        table,
        store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    );
  return { app, store, settings, names, get, remove, snapshot, headers };
}

it("shows the same70 students through dashboard, roster and CSV without changing admission or history", async () => {
  const t = await fixture(),
    before = t.snapshot();
  const dashboard = await t.get("dashboard"),
    roster = await t.get("roster"),
    exported = await t.get("roster/export");
  for (const response of [dashboard, roster, exported])
    expect(response.statusCode, response.body).toBe(200);
  expect(dashboard.json().counts.students).toBe(70);
  expect(dashboard.json().students.map((s: any) => s.username)).toEqual(
    t.names,
  );
  expect(roster.json().map((s: any) => s.username)).toEqual(t.names);
  const csv = parse(exported.body, { columns: true }) as any[];
  expect(csv.map((s) => s.username)).toEqual(t.names);
  for (const username of t.names.slice(66)) {
    const row = roster.json().find((s: any) => s.username === username);
    expect(row.duration).toBe(7200);
    expect(row.webcam).toBe(0);
    expect(row.uid).toBe(0);
    expect(csv.find((s) => s.username === username)).toMatchObject({
      require_webcam: "false",
      duration_minutes: "120",
    });
    expect(
      dashboard.json().students.find((s: any) => s.username === username)
        .removable,
    ).toBe(false);
  }
  expect(t.snapshot()).toEqual(before);
  const searched = await t.get("dashboard?q=student069");
  expect(searched.json().students.map((s: any) => s.username)).toEqual([
    "student069",
  ]);
  expect(searched.json().counts.students).toBe(70);
  expect(
    (await t.app.inject({ url: `/api/admin/exams/${t.settings.id}/roster` }))
      .statusCode,
  ).toBe(401);
});

it("keeps a grant-only student in every list without reviving a missing admission record", async () => {
  const t = await fixture(),
    roster = new RosterManagement(t.store, undefined, "class");
  roster.add(
    t.settings.id,
    { username: "grant_only", duration: 9000, webcam: false },
    "instructor",
  );
  // Reproduce a legacy incomplete transfer, not a supported removal operation.
  t.store.db
    .prepare("DELETE FROM enrollments WHERE exam=? AND username='grant_only'")
    .run(t.settings.id);
  const before = t.snapshot();
  const dashboard = await t.get("dashboard"),
    listed = await t.get("roster"),
    exported = await t.get("roster/export");
  expect(dashboard.json().counts.students).toBe(71);
  expect(dashboard.json().students[0]).toMatchObject({
    username: "grant_only",
    removable: false,
  });
  expect(listed.json()[0]).toMatchObject({
    username: "grant_only",
    duration: 9000,
    webcam: 0,
    uid: 0,
  });
  expect((parse(exported.body, { columns: true }) as any[])[0]).toMatchObject({
    username: "grant_only",
    duration_minutes: "150",
    require_webcam: "false",
  });
  expect(t.snapshot()).toEqual(before);
  expect((await t.remove("grant_only")).statusCode).toBe(409);
  expect(t.snapshot()).toEqual(before);
});

it("refuses removal of historical students and allowed attempts, but removes untouched setup metadata", async () => {
  const t = await fixture(),
    before = t.snapshot();
  const refusal = await t.remove(t.names[69]);
  expect(refusal.statusCode).toBe(409);
  expect(refusal.json().error).toContain("Cancel their unused attempt");
  expect(t.snapshot()).toEqual(before);
  const permitted = new RosterManagement(t.store, undefined, "class");
  permitted.add(t.settings.id, { username: "permitted_student" }, "instructor");
  const afterGrant = t.snapshot();
  expect((await t.remove("permitted_student")).statusCode).toBe(409);
  expect(t.snapshot()).toEqual(afterGrant);
  const removed = await t.remove("other_student", "another-exam");
  expect(removed.statusCode, removed.body).toBe(200);
  const other = await t.app.inject({
    url: "/api/admin/exams/another-exam/dashboard",
    headers: t.headers,
  });
  expect(other.json().students).toEqual([]);
  expect(
    (await t.get("dashboard")).json().students.map((s: any) => s.username),
  ).toContain(t.names[69]);
});
