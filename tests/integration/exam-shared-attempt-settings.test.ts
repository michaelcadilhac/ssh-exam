import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { createApp } from "../../apps/server/src/app.js";
import { hash } from "../../apps/server/src/db.js";
import { AttemptGrants } from "../../apps/server/src/attempt-grants.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";
import { grantRevision } from "../../packages/protocol/grants.js";
import { grantExam } from "../fixtures/grant-exam.js";

async function fixture(withHistory = false) {
  const data = mkdtempSync(tmpdir() + "/exam-shared-attempt-settings-"),
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
    settings = grantExam(store, "shared-exam"),
    definitions = new ExamDefinitions(store, "class"),
    grants = new AttemptGrants(store, "class"),
    admin = store.session("admin", "instructor", null),
    headers = {
      origin,
      cookie: `session=${admin.token}`,
      "x-csrf-token": admin.csrf,
    },
    post = (url: string, payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url, headers, payload }),
    read = (url: string) => app.inject({ url, headers }),
    preview = () => {
      const definition = definitions.show(settings.id);
      return post(`/api/admin/exams/${settings.id}/grants/additional-preview`, {
        definition_revision: definition.revision,
        template_version: definition.exam.template_version,
        usernames: ["student"],
        preserve_duration: true,
        earliest: Date.now() + 7200000,
        latest: Date.now() + 10800000,
        reason:
          "Explicitly allow a new attempt with current shared exam settings",
        request: randomUUID(),
      });
    },
    confirm = (review: any) =>
      post(`/api/admin/grant-issuance/${review.id}/confirm`, {
        revision: review.revision,
        replacement_policy: "single-unused-v1",
        request: randomUUID(),
      }),
    domain = () =>
      Object.fromEntries(
        [
          "exams",
          "enrollments",
          "attempts",
          "attempt_grants",
          "grant_revisions",
          "grant_claims",
          "grant_begin_intents",
          "grant_source_setup",
          "grant_management_requests",
          "grant_issuance_previews",
          "audit",
        ].map((table) => [
          table,
          store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ]),
      );
  let oldAttempt: string | undefined;
  if (withHistory) {
    // Author legacy membership and history before grant mode; the new allowed
    // attempt is then issued through the real reviewed public workflow.
    oldAttempt = randomUUID();
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid,duration,webcam) VALUES(?,'student',10001,7200,0)",
      )
      .run(settings.id);
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,access_state) VALUES(?,?,'student',10001,'COMPLETED',?,?,?,?,1,'RELEASED')",
      )
      .run(
        oldAttempt,
        settings.id,
        JSON.stringify(settings),
        1000,
        5401000,
        5401000,
      );
    const review = await preview();
    expect(review.statusCode, review.body).toBe(200);
    const issued = await confirm(review.json());
    expect(issued.statusCode, issued.body).toBe(200);
  } else {
    const added = await post(`/api/admin/exams/${settings.id}/roster/add`, {
      username: "student",
      duration: 7200,
      webcam: false,
    });
    expect(added.statusCode, added.body).toBe(200);
  }
  const grant = grants.current(settings.id, "student")!;
  const claim = (page = randomUUID()) => {
    const id = randomUUID(),
      binding = grants.binding(grant);
    store.db.transaction(() => {
      grants.claim(grant.id, id, 10001);
      store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,page_hash,grant_id,grant_revision,grant_hash,grant_kind,grant_issued_order,grant_initial) VALUES(?,?,'student',10001,'PREPARING',?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          settings.id,
          JSON.stringify(grant.settings),
          hash(page),
          grant.id,
          grant.revision,
          grant.hash,
          binding.kind ?? null,
          grant.issuance_order,
          binding.initial_grant ?? null,
        );
    })();
    return { attempt: store.attempt(id), page };
  };
  const consume = (attempt: ReturnType<typeof store.attempt>) => {
    // Complete the saved legacy native-outcome transaction. This authors
    // synthetic metadata, not live native permission or execution.
    grants.begin(attempt, "e".repeat(64));
    const current = store.attempt(attempt.id),
      start = Date.now(),
      deadline = start + JSON.parse(current.settings).duration * 1000;
    store.db.transaction(() => {
      grants.accept(
        {
          id: current.id,
          exam: current.exam,
          username: current.username,
          uid: current.uid,
          state: "ACTIVE",
          settings: JSON.parse(current.settings),
          grant: grants.bindingForAttempt(current),
          grant_begin_intent: current.grant_begin_intent,
          start,
          deadline,
          original_deadline: deadline,
        },
        current,
      );
      store.db
        .prepare(
          "UPDATE attempts SET state='ACTIVE',start=?,deadline=?,original_deadline=? WHERE id=?",
        )
        .run(start, deadline, deadline, current.id);
    })();
    return store.attempt(current.id);
  };
  return {
    app,
    store,
    origin,
    settings,
    definitions,
    grants,
    headers,
    post,
    read,
    preview,
    confirm,
    domain,
    grant,
    claim,
    consume,
    oldAttempt,
    async close() {
      await app.close();
      rmSync(data, { recursive: true, force: true });
    },
  };
}

it.each([
  { terminals: 2 },
  { collection_file_mib: 64 },
  { collection_total_mib: 256 },
  { name: "Per-student exam name" },
  { template: "other-materials" },
  { template_version: "b".repeat(64) },
])(
  "refuses new per-attempt shared settings %j without partial personal or workspace changes",
  async (shared) => {
    const f = await fixture();
    try {
      const before = f.domain(),
        response = await f.post(`/api/admin/grants/${f.grant.id}/revise`, {
          revision: f.grant.revision,
          changes: { duration: 900, ...shared },
          work: { kind: "empty" },
          reason: "Synthetic attempt to change shared exam settings",
          request: randomUUID(),
        });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error).toContain(
        `examctl web exams update ${f.settings.id}`,
      );
      expect(response.json().error).toContain("No attempt changed");
      expect(f.domain()).toEqual(before);
    } finally {
      await f.close();
    }
  },
);

it("still revises only personal fields and starting files without replacing saved shared values", async () => {
  const f = await fixture();
  try {
    const earliest = Date.now() - 1000,
      latest = Date.now() + 1200000,
      response = await f.post(`/api/admin/grants/${f.grant.id}/revise`, {
        revision: f.grant.revision,
        changes: { duration: 6300, webcam: true, earliest, latest },
        work: { kind: "empty" },
        reason: "Explicit inline personal attempt settings",
        request: randomUUID(),
      });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      revision: 2,
      settings: {
        duration: 6300,
        webcam: true,
        earliest,
        latest,
        terminals: 4,
        collection_file_mib: 128,
        collection_total_mib: 512,
      },
      work: { kind: "empty" },
    });
    expect(f.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 0 },
    );
  } finally {
    await f.close();
  }
});

it("replays an already applied historical shared-setting request after later revisions without applying it again", async () => {
  const f = await fixture();
  try {
    const legacy = {
      revision: 1,
      changes: {
        terminals: 2,
        collection_file_mib: 32,
        collection_total_mib: 128,
      },
      reason:
        "Historical accepted shared-setting revision before policy change",
      request: randomUUID(),
    };
    // Model an authentic pre-upgrade applied request using the existing durable
    // transaction/fingerprint and revision format; public replay is tested below.
    const prior = f.grants.request(
      "instructor",
      legacy.request,
      { id: f.grant.id, ...grantRevision.parse(legacy) },
      () => {
        const value = f.grants.snapshot(
          { ...f.grant.settings, ...legacy.changes },
          f.grant.work,
          "student",
        );
        f.store.db
          .prepare("INSERT INTO grant_revisions VALUES(?,?,?,?,?,?,?,?)")
          .run(
            f.grant.id,
            2,
            JSON.stringify(value.settings),
            JSON.stringify(value.work),
            value.hash,
            "instructor",
            legacy.reason,
            Date.now(),
          );
        f.store.db
          .prepare("UPDATE attempt_grants SET revision=2 WHERE id=?")
          .run(f.grant.id);
        f.store.audit(
          "instructor",
          "revise-unused-grant",
          f.grant.id,
          JSON.stringify({
            revision: 2,
            reason: legacy.reason,
            hash: value.hash,
          }),
        );
        return f.grants.show({ id: f.grant.id });
      },
    );
    const later = await f.post(`/api/admin/grants/${f.grant.id}/revise`, {
      revision: 2,
      changes: { duration: 6300 },
      reason: "Later personal time revision",
      request: randomUUID(),
    });
    expect(later.statusCode, later.body).toBe(200);
    const before = f.domain(),
      replay = await f.post(`/api/admin/grants/${f.grant.id}/revise`, legacy);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(prior);
    expect(f.domain()).toEqual(before);
    expect(f.grants.current(f.settings.id, "student")?.revision).toBe(3);
  } finally {
    await f.close();
  }
});

it("new allowed attempts use current shared exam settings and inherit only the student's time and webcam", async () => {
  const f = await fixture();
  try {
    const cancelled = await f.post(`/api/admin/grants/${f.grant.id}/revoke`, {
      revision: 1,
      reason: "Cancel unused attempt before updating shared exam settings",
      request: randomUUID(),
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    new TemplateCatalog(f.store, "class").sync(
      {
        version: {
          schema: 1,
          name: "new-materials",
          hash: "d".repeat(64),
          entries: 4,
          files: 2,
          bytes: 30,
          max_file_bytes: 20,
          created: 1000,
        },
        reason: "Synthetic current shared material attestation",
      },
      {
        agent: "class",
        actor: "agent:class:root",
        request: randomUUID(),
        issued: 1000,
        observed: 1001,
      },
    );
    const updated = await f.post("/api/admin/exams", {
      id: f.settings.id,
      revision: f.definitions.show(f.settings.id).revision,
      name: "Current shared exam",
      terminals: 2,
      collection_file_mib: 64,
      collection_total_mib: 256,
      template: "new-materials",
      template_version: "d".repeat(64),
      reason: "Update exam-wide configuration for new attempts",
    });
    expect(updated.statusCode, updated.body).toBe(200);
    const beforeReview = f.domain(),
      review = await f.preview();
    expect(review.statusCode, review.body).toBe(200);
    expect(review.json().rows[0]).toMatchObject({
      settings: {
        name: "Current shared exam",
        duration: 7200,
        webcam: false,
        terminals: 2,
        collection_file_mib: 64,
        collection_total_mib: 256,
        template: "new-materials",
        template_version: "d".repeat(64),
      },
      work: { kind: "template", name: "new-materials", hash: "d".repeat(64) },
    });
    expect(review.json().rows[0].settings.earliest).toBeGreaterThan(
      f.settings.latest,
    );
    const issued = await f.confirm(review.json());
    expect(issued.statusCode, issued.body).toBe(200);
    expect(f.grants.current(f.settings.id, "student")?.settings).toEqual(
      review.json().rows[0].settings,
    );
    expect(f.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 0 },
    );
    expect(
      f.store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
    ).toEqual({ n: 0 });
    expect(
      f.store.db
        .prepare(
          "SELECT * FROM grant_revisions WHERE grant_id=? AND revision=1",
        )
        .get(f.grant.id),
    ).toEqual(
      (beforeReview.grant_revisions as any[]).find(
        (r) => r.grant_id === f.grant.id && r.revision === 1,
      ),
    );
  } finally {
    await f.close();
  }
});

it("refuses an unconfirmed legacy review carrying per-student shared overrides, without replacing authority", async () => {
  const f = await fixture();
  try {
    const response = await f.preview();
    expect(response.statusCode, response.body).toBe(200);
    const id = response.json().id,
      stored = f.store.db
        .prepare("SELECT snapshot FROM grant_issuance_previews WHERE id=?")
        .get(id) as { snapshot: string },
      saved = JSON.parse(stored.snapshot);
    // Older writers inherited these fields from each student's previous grant.
    const row = saved.rows[0],
      value = f.grants.snapshot(
        {
          ...row.settings,
          terminals: 2,
          collection_file_mib: 32,
          collection_total_mib: 128,
        },
        row.work,
        row.username,
      );
    Object.assign(row, value);
    const snapshot = JSON.stringify(saved);
    f.store.db
      .prepare(
        "UPDATE grant_issuance_previews SET snapshot=?,revision=? WHERE id=?",
      )
      .run(snapshot, hash(snapshot), id);
    const legacy = await f.read(`/api/admin/grant-issuance/${id}`);
    expect(legacy.statusCode, legacy.body).toBe(200);
    const before = f.domain(),
      refused = await f.confirm(legacy.json());
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error).toContain("older per-attempt exam settings");
    expect(f.domain()).toEqual(before);
  } finally {
    await f.close();
  }
});

it("webcam off refuses both camera challenges and uploads through the public student interface", async () => {
  const f = await fixture();
  try {
    const prepared = f.claim(),
      attempt = f.consume(prepared.attempt),
      page = prepared.page,
      student = f.store.session("student", "student", f.settings.id),
      headers = {
        origin: f.origin,
        cookie: `session=${student.token}`,
        "x-csrf-token": student.csrf,
        "x-page-instance": page,
      },
      send = (suffix: string, payload: Record<string, unknown>) =>
        f.app.inject({
          method: "POST",
          url: `/api/student/attempts/${attempt.id}/${suffix}`,
          headers,
          payload,
        });
    const screen = await send("capture-challenges", { source: "screen" });
    expect(screen.statusCode, screen.body).toBe(200);
    const camera = await send("capture-challenges", { source: "webcam" });
    expect(camera.statusCode, camera.body).toBe(409);
    expect(camera.json().error).toContain("source is not required");
    const image = await sharp({
        create: { width: 40, height: 30, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer(),
      upload = await send("frames", {
        source: "webcam",
        seq: 1,
        captured: Date.now(),
        monotonic: 1,
        data: image.toString("base64"),
      });
    expect(upload.statusCode, upload.body).toBe(400);
    expect(upload.json().error).toBe("Webcam not requested");
    expect(f.store.db.prepare("SELECT count(*) n FROM frames").get()).toEqual({
      n: 0,
    });
    expect(f.store.attempt(attempt.id)).toEqual(attempt);
  } finally {
    await f.close();
  }
});

it("dashboard distinguishes claimed and consumed authority while retaining full matching-student history", async () => {
  const f = await fixture(true);
  try {
    // This fixture's public review intentionally used a later window. Open its
    // dates through the real personal revision path before authoring a claim.
    const revised = await f.post(`/api/admin/grants/${f.grant.id}/revise`, {
      revision: f.grant.revision,
      changes: { earliest: Date.now() - 1000 },
      reason: "Open synthetic setup window",
      request: randomUUID(),
    });
    expect(revised.statusCode, revised.body).toBe(200);
    Object.assign(f.grant, f.grants.current(f.settings.id, "student"));
    const { attempt } = f.claim(),
      url = `/api/admin/exams/${f.settings.id}/dashboard?view=COMPLETED`,
      claimed = await f.read(url);
    expect(claimed.statusCode, claimed.body).toBe(200);
    expect(claimed.json().students[0]).toMatchObject({
      hasNextAttempt: true,
      unusedAttempt: null,
      hasCurrentAttempt: true,
    });
    expect(claimed.json().students[0].attempts.map((a: any) => a.id)).toEqual([
      attempt.id,
      f.oldAttempt,
    ]);
    f.consume(attempt);
    const consumed = await f.read(url);
    expect(consumed.statusCode, consumed.body).toBe(200);
    expect(consumed.json().students[0]).toMatchObject({
      hasNextAttempt: false,
      unusedAttempt: null,
      hasCurrentAttempt: true,
    });
    expect(consumed.json().students[0].attempts.map((a: any) => a.id)).toEqual([
      attempt.id,
      f.oldAttempt,
    ]);
  } finally {
    await f.close();
  }
});

it("dashboard conservatively reports a Next attempt when grant metadata is ambiguous or invalid", async () => {
  const f = await fixture();
  try {
    f.store.db
      .prepare(
        "UPDATE grant_revisions SET settings='{}' WHERE grant_id=? AND revision=?",
      )
      .run(f.grant.id, f.grant.revision);
    const dashboard = await f.read(
      `/api/admin/exams/${f.settings.id}/dashboard`,
    );
    expect(dashboard.statusCode, dashboard.body).toBe(200);
    expect(dashboard.json().students[0]).toMatchObject({
      hasNextAttempt: true,
      unusedAttempt: null,
      grantError: true,
    });
  } finally {
    await f.close();
  }
});
