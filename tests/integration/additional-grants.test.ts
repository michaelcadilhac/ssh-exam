import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { grantExam } from "../fixtures/grant-exam.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";
import { AttemptGrants } from "../../apps/server/src/attempt-grants.js";

it("authorizes separate full additional attempts outside expired defaults without rewriting protected history or consuming time", async () => {
  const data = mkdtempSync(tmpdir() + "/additional-grants-"),
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
  try {
    const original = grantExam(store, "midterm"),
      definitions = new ExamDefinitions(store, "class");
    definitions.update(
      "midterm",
      { earliest: Date.now() - 10800000, latest: Date.now() - 7200000 },
      definitions.show("midterm").revision,
      "instructor",
      "Closed original default window",
    );
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid,webcam) VALUES('midterm','student',10001,0)",
      )
      .run();
    const start = Date.now() - 10800000;
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state) VALUES('protected-first','midterm','student',10001,'COMPLETED',?,?,?,?,1,?,'RELEASED')",
      )
      .run(
        JSON.stringify(original),
        start,
        start + 5400000,
        start + 5400000,
        "b".repeat(64),
      );
    const before = store.attempt("protected-first"),
      session = store.session("admin", "instructor", null),
      headers = {
        origin,
        cookie: `session=${session.token}`,
        "x-csrf-token": session.csrf,
      },
      post = (url: string, payload: any) =>
        app.inject({ method: "POST", url, headers, payload });
    const input = {
      definition_revision: definitions.show("midterm").revision,
      template_version: original.template_version,
      earliest: Date.now() - 1000,
      latest: Date.now() + 600000,
      usernames: ["student"],
      duration: 5400,
      reason: "Explicit second full ninety-minute attempt",
      request: randomUUID(),
    };
    const result = await post(
      "/api/admin/exams/midterm/grants/additional-preview",
      input,
    );
    expect(result.statusCode, result.body).toBe(200);
    const review = result.json();
    expect(review).toMatchObject({
      kind: "NEW_ADDITIONAL_TEMPLATE_GRANTS",
      status: "REVIEW",
      rows: [
        {
          username: "student",
          settings: {
            duration: 5400,
            webcam: false,
            earliest: input.earliest,
            latest: input.latest,
          },
        },
      ],
    });
    expect(
      store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
    ).toEqual({ n: 0 });
    const intent = { revision: review.revision, request: randomUUID() },
      confirmed = await post(
        `/api/admin/grant-issuance/${review.id}/confirm`,
        intent,
      );
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(
      (
        await post(`/api/admin/grant-issuance/${review.id}/confirm`, intent)
      ).json(),
    ).toEqual(confirmed.json());
    const id = confirmed.json().issued[0].grant;
    expect(
      store.db
        .prepare(
          "SELECT action FROM audit WHERE target=? AND action='issue-additional-grant'",
        )
        .get(id),
    ).toEqual({ action: "issue-additional-grant" });
    const issued = await app.inject({
      url: `/api/admin/grants/${id}`,
      headers,
    });
    expect(issued.json()).toMatchObject({
      issuance: "ADDITIONAL_TEMPLATE",
      status: "AVAILABLE",
      settings: {
        duration: 5400,
        webcam: false,
        earliest: input.earliest,
        latest: input.latest,
      },
    });
    const another = await post(
      "/api/admin/exams/midterm/grants/additional-preview",
      { ...input, webcam: true, request: randomUUID() },
    );
    expect(another.statusCode, another.body).toBe(200);
    expect(another.json().rows[0].settings.webcam).toBe(true);
    expect(
      (
        await post(`/api/admin/grant-issuance/${another.json().id}/confirm`, {
          revision: another.json().revision,
          request: randomUUID(),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
    ).toEqual({ n: 2 });
    expect(store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual({
      n: 1,
    });
    expect(store.attempt("protected-first")).toEqual(before);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});

it.each(["empty", "template"])(
  "HTTP review and explicit revision retain an independent %s workspace without consumption",
  async (kind) => {
    const data = mkdtempSync(tmpdir() + "/grant-work-"),
      origin = "http://localhost:3000";
    const { app, store } = await createApp({
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
    try {
      const settings = grantExam(store, "work-sources"),
        hash = "c".repeat(64);
      new TemplateCatalog(store, "class").sync(
        {
          version: {
            schema: 1,
            name: "starter",
            hash,
            entries: 4,
            files: 2,
            bytes: 30,
            max_file_bytes: 20,
            created: 1000,
          },
          reason: "Independent synthetic starter attestation",
        },
        {
          agent: "class",
          actor: "agent:class:root",
          request: randomUUID(),
          issued: 1000,
          observed: 1001,
        },
      );
      store.db
        .prepare(
          "INSERT INTO enrollments(exam,username,uid) VALUES('work-sources','student',10001)",
        )
        .run();
      const session = store.session("admin", "instructor", null),
        headers = {
          origin,
          cookie: `session=${session.token}`,
          "x-csrf-token": session.csrf,
        };
      const post = (url: string, payload: any) =>
        app.inject({ method: "POST", url, headers, payload });
      const work =
        kind === "empty" ? { kind } : { kind, name: "starter", hash };
      const input = {
        definition_revision: new ExamDefinitions(store, "class").show(
          settings.id,
        ).revision,
        template_version: settings.template_version,
        earliest: settings.earliest,
        latest: settings.latest,
        usernames: ["student"],
        duration: 4500,
        work,
        reason: "Independent starter with chosen allowance",
      };
      const preview = await post(
        `/api/admin/exams/${settings.id}/grants/additional-preview`,
        input,
      );
      expect(preview.statusCode, preview.body).toBe(200);
      expect(preview.json().rows[0]).toMatchObject({
        work,
        settings: { template: "v1", duration: 4500, webcam: true },
      });
      const review = preview.json(),
        confirm = { revision: review.revision, request: randomUUID() };
      const reply = await post(
        `/api/admin/grant-issuance/${review.id}/confirm`,
        confirm,
      );
      expect(reply.statusCode, reply.body).toBe(200);
      expect(
        (
          await post(`/api/admin/grant-issuance/${review.id}/confirm`, confirm)
        ).json(),
      ).toEqual(reply.json());
      const id = reply.json().issued[0].grant;
      const revised = await post(`/api/admin/grants/${id}/revise`, {
        revision: 1,
        changes: { duration: 5400 },
        reason: "Settings-only change must retain work source",
      });
      expect(revised.statusCode, revised.body).toBe(200);
      expect(revised.json()).toMatchObject({
        revision: 2,
        work,
        settings: { duration: 5400, template: "v1" },
      });
      const changed = await post(`/api/admin/grants/${id}/revise`, {
        revision: 2,
        changes: {},
        work: { kind: "empty" },
        reason: "Explicit unused source revision only",
      });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(changed.json()).toMatchObject({
        revision: 3,
        work: { kind: "empty" },
        settings: { duration: 5400, template: "v1" },
      });
      for (const invalid of [
        { kind: "saved", attempt: randomUUID(), checksum: hash },
        { kind: "template", name: "missing", hash },
        { kind: "empty", name: "starter" },
      ]) {
        const refused = await post(
          `/api/admin/exams/${settings.id}/grants/additional-preview`,
          { ...input, work: invalid },
        );
        expect(refused.statusCode, refused.body).not.toBe(200);
      }
      expect(
        store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
      ).toEqual({ n: 1 });
      expect(store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
        { n: 0 },
      );
      expect(
        store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
      ).toEqual({ n: 0 });
      const authority = new AttemptGrants(store, "class"),
        probe = randomUUID();
      expect(() =>
        store.db.transaction(() => {
          const g = authority.claim(id, probe, 10001);
          store.db
            .prepare(
              "INSERT INTO attempts(id,exam,username,uid,state,settings,grant_id,grant_revision,grant_hash,grant_kind,grant_issued_order,grant_initial) VALUES(?,?,?,?,'PREPARING',?,?,?,?,?,?,?)",
            )
            .run(
              probe,
              settings.id,
              "student",
              10001,
              JSON.stringify(g.settings),
              id,
              g.revision,
              g.hash,
              "ADDITIONAL",
              g.issuance_order,
              g.initial_grant,
            );
        })(),
      ).toThrow("Exact prepared workspace source required");
      expect(
        store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
      ).toEqual({ n: 0 });
    } finally {
      await app.close();
      rmSync(data, { recursive: true, force: true });
    }
  },
);
