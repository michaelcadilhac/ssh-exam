import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createApp } from "../../apps/server/src/app.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { grantExam } from "../fixtures/grant-exam.js";

async function fixture() {
  const data = mkdtempSync(tmpdir() + "/roster-windows-"),
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
  const defaults = grantExam(store, "roster-window"),
    admin = store.session("admin", "instructor", null);
  const headers = {
    origin,
    cookie: `session=${admin.token}`,
    "x-csrf-token": admin.csrf,
  };
  const post = (suffix: string, body: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/admin/exams/roster-window/roster/" + suffix,
      headers,
      payload: body as any,
    });
  const grants = async (username: string) => {
    const response = await app.inject({
      url: `/api/admin/exams/roster-window/grants?username=${username}`,
      headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().grants;
  };
  const changeDefaults = async (duration = 3600) => {
    const revision = new ExamDefinitions(store, "class").show(
      defaults.id,
    ).revision;
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/exams",
      headers,
      payload: {
        id: defaults.id,
        revision,
        duration,
        webcam: false,
        reason: "Change inherited settings after a reviewed roster snapshot",
      },
    });
    expect(response.statusCode, response.body).toBe(200);
  };
  const domain = () =>
    Object.fromEntries(
      [
        "enrollments",
        "attempts",
        "attempt_grants",
        "grant_revisions",
        "grant_claims",
        "grant_begin_intents",
        "recovery_allowance_edits",
      ].map((table) => [
        table,
        store.db.prepare(`SELECT * FROM ${table}`).all(),
      ]),
    );
  return {
    app,
    store,
    defaults,
    headers,
    post,
    grants,
    changeDefaults,
    domain,
    close: async () => {
      await app.close();
      rmSync(data, { recursive: true, force: true });
    },
  };
}

it("single enrollment saves exact chosen past dates only for a new first attempt, preserving defaults and re-enrollment history", async () => {
  const f = await fixture();
  try {
    const window = {
      earliest: Date.parse("2026-01-02T08:15:00.123Z"),
      latest: Date.parse("2026-01-03T23:42:00.456Z"),
    };
    const first = await f.post("add", {
      username: "student",
      duration: 4500,
      webcam: false,
      ...window,
    });
    expect(first.statusCode, first.body).toBe(200);
    const [saved] = await f.grants("student");
    expect(saved.settings).toMatchObject({
      ...window,
      duration: 4500,
      webcam: false,
      template_version: f.defaults.template_version,
    });
    expect(
      JSON.parse(
        (
          f.store.db
            .prepare("SELECT config FROM exams WHERE id=?")
            .get(f.defaults.id) as any
        ).config,
      ),
    ).toEqual(f.defaults);
    expect(
      (await f.post("remove", { username: "student", confirm: true }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await f.post("add", {
          username: "student",
          earliest: f.defaults.earliest,
          latest: f.defaults.latest,
        })
      ).statusCode,
    ).toBe(200);
    expect(await f.grants("student")).toEqual([saved]);
    expect(
      (await f.post("add", { username: "defaultstudent" })).statusCode,
    ).toBe(200);
    expect((await f.grants("defaultstudent"))[0].settings).toMatchObject({
      earliest: f.defaults.earliest,
      latest: f.defaults.latest,
    });
    expect(f.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 0 },
    );
  } finally {
    await f.close();
  }
});

it("enrollment date validation and a stale displayed definition refuse without partial authority, including sandbox custom dates", async () => {
  const f = await fixture();
  try {
    const windows = [
      { earliest: Date.now() },
      { latest: Date.now() + 60000 },
      { earliest: 0, latest: Date.now() + 60000 },
      { earliest: Date.now() + 60000, latest: Date.now() },
      { earliest: Date.now(), latest: 8640000000000000 },
    ];
    for (const [index, window] of windows.entries()) {
      const before = f.domain();
      const refused = await f.post("add", {
        username: `invalid${index}`,
        ...window,
      });
      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.json()).not.toHaveProperty("code");
      expect(f.domain()).toEqual(before);
    }
    const shownRevision = new ExamDefinitions(f.store, "class").show(
      f.defaults.id,
    ).revision;
    await f.changeDefaults();
    const before = f.domain();
    const stale = await f.post("add", {
      username: "staledefaults",
      definition_revision: shownRevision,
      earliest: f.defaults.earliest,
      latest: f.defaults.latest,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).not.toHaveProperty("code");
    expect(stale.json().error).toMatch(/defaults changed|definition changed/i);
    expect(f.domain()).toEqual(before);
    const sandbox = await f.app.inject({
      method: "POST",
      url: "/api/admin/exams/sandbox/roster/add",
      headers: f.headers,
      payload: {
        username: "practice",
        earliest: f.defaults.earliest,
        latest: f.defaults.latest,
      },
    });
    expect(sandbox.statusCode).toBe(400);
    expect(sandbox.json().error).toMatch(
      /practice.*defaults|sandbox.*defaults/i,
    );
    expect(f.domain()).toEqual(before);
  } finally {
    await f.close();
  }
});

it("CSV review binds a common chosen window and current inherited settings, preserving existing first attempts and consumed retries", async () => {
  const f = await fixture();
  try {
    expect((await f.post("add", { username: "existing" })).statusCode).toBe(
      200,
    );
    const existing = await f.grants("existing");
    await f.changeDefaults();
    const window = {
      earliest: f.defaults.latest + 60000,
      latest: f.defaults.latest + 3600000,
    };
    const preview = await f.post("import-preview", {
      ...window,
      text: "username,duration_minutes,require_webcam\nexisting,75,true\nnewone,60,false\nnewtwo,inherit,inherit",
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({
      ...window,
      defaults: { duration: 3600, webcam: false },
    });
    const confirmed = await f.post("import-confirm", { id: preview.json().id });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(await f.grants("existing")).toEqual(existing);
    expect((await f.grants("newone"))[0].settings).toMatchObject({
      ...window,
      duration: 3600,
      webcam: false,
    });
    expect((await f.grants("newtwo"))[0].settings).toMatchObject({
      ...window,
      duration: 3600,
      webcam: false,
    });
    const before = f.domain();
    await f.changeDefaults(7200);
    expect(
      (await f.post("import-confirm", { id: preview.json().id })).statusCode,
    ).toBe(200);
    expect(f.domain()).toEqual(before);
  } finally {
    await f.close();
  }
});

it.each(["defaults", "target-roster"])(
  "CSV confirmation refuses changed %s before any new enrollment, grant or clock and permits a fresh review",
  async (change) => {
    const f = await fixture();
    try {
      expect((await f.post("add", { username: "zexisting" })).statusCode).toBe(
        200,
      );
      const window = {
        earliest: f.defaults.latest + 60000,
        latest: f.defaults.latest + 7200000,
      };
      const input = { ...window, text: "username\nalpha\nzexisting" };
      const preview = await f.post("import-preview", input);
      expect(preview.statusCode, preview.body).toBe(200);
      if (change === "defaults") await f.changeDefaults();
      else
        expect(
          (
            await f.post("settings", {
              usernames: ["zexisting"],
              duration: 1200,
            })
          ).statusCode,
        ).toBe(200);
      const before = f.domain();
      const refused = await f.post("import-confirm", { id: preview.json().id });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().code).toBe("ROSTER_REVIEW_REQUIRED");
      expect(refused.json().error).toMatch(
        /changed since preview|defaults changed/i,
      );
      expect(f.domain()).toEqual(before);
      expect(
        f.store.db
          .prepare("SELECT consumed FROM previews WHERE id=?")
          .get(preview.json().id),
      ).toEqual({ consumed: 0 });
      const revised = await f.post("import-preview", input);
      expect(revised.statusCode, revised.body).toBe(200);
      const confirmed = await f.post("import-confirm", {
        id: revised.json().id,
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      expect((await f.grants("alpha"))[0].settings).toMatchObject(window);
    } finally {
      await f.close();
    }
  },
);

it("unrelated roster edits do not invalidate a review, while known pre-write review refusals remain safely retryable", async () => {
  const f = await fixture();
  try {
    const input = {
      text: "username\nfirst",
      earliest: f.defaults.earliest,
      latest: f.defaults.latest,
    };
    const reviewed = await f.post("import-preview", input);
    expect(reviewed.statusCode).toBe(200);
    expect((await f.post("add", { username: "unrelated" })).statusCode).toBe(
      200,
    );
    expect(
      (await f.post("import-confirm", { id: reviewed.json().id })).statusCode,
    ).toBe(200);
    for (const mode of ["missing", "expired", "legacy", "agent"]) {
      const preview = await f.post("import-preview", {
        ...input,
        text: `username\n${mode}student`,
      });
      expect(preview.statusCode).toBe(200);
      if (mode === "expired")
        f.store.db
          .prepare("UPDATE previews SET created=? WHERE id=?")
          .run(Date.now() - 600001, preview.json().id);
      else if (mode === "legacy" || mode === "agent") {
        const old = JSON.parse(
          (
            f.store.db
              .prepare("SELECT rows FROM previews WHERE id=?")
              .get(preview.json().id) as any
          ).rows,
        );
        f.store.db
          .prepare("UPDATE previews SET rows=? WHERE id=?")
          .run(
            JSON.stringify(
              mode === "legacy"
                ? { rows: old.rows, checksum: old.checksum }
                : { ...old, agent: "another-class" },
            ),
            preview.json().id,
          );
      }
      const before = f.domain();
      const refused = await f.post("import-confirm", {
        id: mode === "missing" ? randomUUID() : preview.json().id,
      });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().code).toBe("ROSTER_REVIEW_REQUIRED");
      expect(refused.json().error).toMatch(
        /expired|review.*again|preview.*again/i,
      );
      expect(f.domain()).toEqual(before);
      expect(
        f.store.db
          .prepare("SELECT consumed FROM previews WHERE id=?")
          .get(preview.json().id),
      ).toEqual({ consumed: 0 });
    }
  } finally {
    await f.close();
  }
});

it("closed legacy sandbox CSV enrollment preserves unset dates and creates no practice permission", async () => {
  const f = await fixture();
  try {
    const prior = JSON.parse(
      (
        f.store.db
          .prepare("SELECT config FROM exams WHERE id='sandbox'")
          .get() as any
      ).config,
    );
    const closed = { ...prior, earliest: 0, latest: 0 };
    f.store.db
      .prepare("UPDATE exams SET config=? WHERE id='sandbox'")
      .run(JSON.stringify(closed));
    const preview = await f.app.inject({
      method: "POST",
      url: "/api/admin/exams/sandbox/roster/import-preview",
      headers: f.headers,
      payload: { text: "username\npracticeone\npracticetwo" },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({
      earliest: 0,
      latest: 0,
      defaults: { duration: 300, webcam: false },
    });
    const confirmed = await f.app.inject({
      method: "POST",
      url: "/api/admin/exams/sandbox/roster/import-confirm",
      headers: f.headers,
      payload: { id: preview.json().id },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(
      f.store.db
        .prepare(
          "SELECT username FROM enrollments WHERE exam='sandbox' ORDER BY username",
        )
        .all(),
    ).toEqual([{ username: "practiceone" }, { username: "practicetwo" }]);
    expect(
      JSON.parse(
        (
          f.store.db
            .prepare("SELECT config FROM exams WHERE id='sandbox'")
            .get() as any
        ).config,
      ),
    ).toEqual(closed);
    for (const table of [
      "attempts",
      "attempt_grants",
      "grant_claims",
      "grant_begin_intents",
    ])
      expect(
        f.store.db.prepare(`SELECT count(*) n FROM ${table}`).get(),
      ).toEqual({ n: 0 });
    const before = f.domain();
    const override = await f.app.inject({
      method: "POST",
      url: "/api/admin/exams/sandbox/roster/import-preview",
      headers: f.headers,
      payload: {
        text: "username\nignoredpractice",
        earliest: f.defaults.earliest,
        latest: f.defaults.latest,
      },
    });
    expect(override.statusCode).toBe(400);
    expect(override.json().error).toMatch(/practice.*defaults/i);
    expect(f.domain()).toEqual(before);
  } finally {
    await f.close();
  }
});

it("an unknown late CSV write failure retains its review and retries the same ID without duplicate authority", async () => {
  const f = await fixture();
  try {
    const preview = await f.post("import-preview", {
      text: "username\nfirstwrite\nsecondwrite",
      earliest: f.defaults.earliest,
      latest: f.defaults.latest,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const id = preview.json().id,
      before = f.domain();
    const priorAudit = f.store.db
      .prepare("SELECT * FROM audit ORDER BY rowid")
      .all();
    // Fire only AFTER the first complete enrollment/grant write in this very
    // transaction. This is an unknown storage refusal, not a stale review.
    f.store.db.exec(`CREATE TEMP TRIGGER refuse_late_roster_write
      BEFORE INSERT ON main.enrollments
      WHEN NEW.username='secondwrite'
        AND EXISTS(SELECT 1 FROM main.enrollments WHERE exam='roster-window' AND username='firstwrite')
        AND EXISTS(SELECT 1 FROM main.attempt_grants WHERE exam='roster-window' AND username='firstwrite')
      BEGIN SELECT RAISE(ABORT,'Synthetic late roster write refusal'); END;`);
    const refused = await f.post("import-confirm", { id });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toContain(
      "Synthetic late roster write refusal",
    );
    expect(refused.json()).not.toHaveProperty("code");
    expect(f.domain()).toEqual(before);
    expect(
      f.store.db.prepare("SELECT * FROM audit ORDER BY rowid").all(),
    ).toEqual(priorAudit);
    expect(
      f.store.db.prepare("SELECT consumed FROM previews WHERE id=?").get(id),
    ).toEqual({ consumed: 0 });
    f.store.db.exec("DROP TRIGGER temp.refuse_late_roster_write");
    const confirmed = await f.post("import-confirm", { id });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(
      f.store.db
        .prepare(
          "SELECT count(*) n FROM enrollments WHERE exam='roster-window'",
        )
        .get(),
    ).toEqual({ n: 2 });
    expect(
      f.store.db
        .prepare(
          "SELECT count(*) n FROM attempt_grants WHERE exam='roster-window'",
        )
        .get(),
    ).toEqual({ n: 2 });
    expect(f.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 0 },
    );
    const committed = f.domain();
    expect((await f.post("import-confirm", { id })).statusCode).toBe(200);
    expect(f.domain()).toEqual(committed);
  } finally {
    await f.close();
  }
});
